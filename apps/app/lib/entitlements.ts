/**
 * What one person may do: their plan's limits and features, after billing
 * status and any hand-set overrides. Every limit check in the app goes through
 * here, so adding a plan, a price or a feature never means hunting for
 * hard-coded numbers.
 *
 * Fail-safe by design: no row, an unknown plan, a lapsed subscription, or a
 * database without the account_plan table yet all resolve to Free, which is
 * exactly what everyone had before plans existed.
 */

import { query } from "./db";
import { isPlanId, PLANS, type Feature, type Limits, type PlanId } from "./plans";

/** Days a past-due subscription keeps its plan while the payment is retried. */
export const GRACE_DAYS = 7;

export interface Entitlements {
  plan: PlanId;
  name: string;
  limits: Limits;
  features: ReadonlySet<Feature>;
  /** Where the plan came from: no row (default), billing, or a hand-set override. */
  source: "default" | "billing" | "override";
  /** Set while a paid plan is active: when it renews or ends. */
  renews_at?: Date;
}

export interface PlanRow {
  plan: string;
  status: string;
  current_period_end: Date | null;
  overrides: unknown;
}

interface Overrides {
  plan?: PlanId;
  limits?: Partial<Limits>;
  features?: Feature[];
}

function readOverrides(raw: unknown): Overrides {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Overrides = {};
  if (isPlanId(o["plan"])) out.plan = o["plan"];
  if (o["limits"] && typeof o["limits"] === "object") {
    const l: Partial<Limits> = {};
    for (const [k, v] of Object.entries(o["limits"] as Record<string, unknown>)) {
      if ((k === "activeShares" || k === "uploadsPerHour" || k === "computers" || k === "maxExpiryDays" || k === "defaultExpiryDays") && Number.isInteger(v) && (v as number) > 0) l[k] = v as number;
      if (k === "expiryDays" && Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d > 0)) l.expiryDays = [...(v as number[])].sort((a, b) => a - b);
    }
    out.limits = l;
  }
  if (Array.isArray(o["features"])) out.features = o["features"].filter((f): f is Feature => typeof f === "string") as Feature[];
  return out;
}

/** Is a billed plan in good standing at `now`? */
export function billingActive(row: PlanRow, now: Date): boolean {
  if (row.status === "active" || row.status === "trialing") return !row.current_period_end || row.current_period_end.getTime() > now.getTime() - GRACE_DAYS * 86_400_000;
  if (row.status === "past_due") return !!row.current_period_end && row.current_period_end.getTime() + GRACE_DAYS * 86_400_000 > now.getTime();
  return false; // canceled
}

/**
 * Pure: entitlements from a plan row (or none). Overrides only ever add: a limit
 * override can raise a number but a plan can't drop below Free, so nobody loses
 * what they had.
 */
export function resolveEntitlements(row: PlanRow | undefined, now = new Date()): Entitlements {
  const free = PLANS.free;
  if (!row) return { plan: "free", name: free.name, limits: free.limits, features: new Set(), source: "default" };
  const ov = readOverrides(row.overrides);
  const billed = isPlanId(row.plan) && billingActive(row, now) ? row.plan : "free";
  const planId: PlanId = ov.plan ?? billed;
  const plan = PLANS[planId];
  const limits: Limits = { ...plan.limits };
  // Never below Free.
  for (const k of ["activeShares", "uploadsPerHour", "computers", "maxExpiryDays"] as const) limits[k] = Math.max(limits[k], free.limits[k]);
  for (const [k, v] of Object.entries(ov.limits ?? {})) {
    if (k === "expiryDays") limits.expiryDays = [...new Set([...limits.expiryDays, ...(v as number[])])].sort((a, b) => a - b);
    else if (k === "defaultExpiryDays") limits.defaultExpiryDays = v as number;
    else (limits as unknown as Record<string, number>)[k] = Math.max((limits as unknown as Record<string, number>)[k] ?? 0, v as number);
  }
  if (!limits.expiryDays.includes(limits.defaultExpiryDays)) limits.defaultExpiryDays = free.limits.defaultExpiryDays;
  const features = new Set<Feature>([...plan.features, ...(ov.features ?? [])]);
  const overridden = !!ov.plan || !!ov.features?.length || Object.keys(ov.limits ?? {}).length > 0;
  return {
    plan: planId,
    name: plan.name,
    limits,
    features,
    source: overridden ? "override" : billed !== "free" ? "billing" : "default",
    ...(billed !== "free" && row.current_period_end ? { renews_at: row.current_period_end } : {}),
  };
}

/** A person's entitlements. A missing account_plan table (migration not run yet) counts as Free. */
export async function entitlementsFor(userId: string): Promise<Entitlements> {
  try {
    const [row] = await query<PlanRow>(`SELECT plan, status, current_period_end, overrides FROM account_plan WHERE user_id = $1`, [userId]);
    return resolveEntitlements(row);
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return resolveEntitlements(undefined); // undefined_table
    throw e;
  }
}

export function can(ent: Entitlements, feature: Feature): boolean {
  return ent.features.has(feature);
}

/** The plan as the API and the CLI see it: stable, additive, no internals. */
export function publicPlan(ent: Entitlements) {
  return {
    id: ent.plan,
    name: ent.name,
    limits: { active_shares: ent.limits.activeShares, uploads_per_hour: ent.limits.uploadsPerHour, computers: ent.limits.computers, expiry_days: ent.limits.expiryDays },
    features: [...ent.features].sort(),
  };
}
