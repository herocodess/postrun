/**
 * Plans: what each tier of app.postrun.app allows. The one place limits and paid
 * features are defined; code asks for a user's entitlements (lib/entitlements.ts)
 * and never checks a plan name directly.
 *
 * Rules that keep existing users safe:
 * - Free is exactly what everyone had before plans existed. Never lower a Free
 *   limit for people who already use it: give new defaults to new accounts and
 *   keep the old values for existing ones with a per-account override.
 * - Everything Postrun does on the user's own computer (recording, review,
 *   export) is never behind a plan. Plans only cover what app.postrun.app hosts.
 * - A plan that isn't `available` can't be bought. It can still be granted by
 *   hand (an override), which is how early access and comps work.
 */

export type PlanId = "free" | "pro" | "team";

/** Paid capabilities. Add a key here, then check it with `can(ent, key)` where it applies. */
export type Feature =
  | "password_links" // a share link that asks for a password
  | "custom_expiry" // pick any expiry date, up to `maxExpiryDays`
  | "no_expiry" // links that last until you turn them off
  | "branded_reports" // your name or logo on shared reports, no "Get Postrun" button
  | "link_insights" // opens over time, first and last opened
  | "pr_links" // post the share link to a GitHub pull request automatically
  | "team_workspace"; // shared links and reviews across a team

export interface Limits {
  /** Live links at once. */
  activeShares: number;
  /** New links per rolling hour. */
  uploadsPerHour: number;
  /** Computers signed in to the account (CLI tokens). */
  computers: number;
  /** Expiry choices offered, in days. */
  expiryDays: readonly number[];
  /** Longest expiry, in days (matters with custom_expiry). */
  maxExpiryDays: number;
  defaultExpiryDays: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Can people sign up for it today? Only Free is, until billing ships. */
  available: boolean;
  limits: Limits;
  features: readonly Feature[];
}

const FREE_LIMITS: Limits = {
  activeShares: 200,
  uploadsPerHour: 30,
  computers: 20,
  expiryDays: [1, 7, 30, 90],
  maxExpiryDays: 90,
  defaultExpiryDays: 30,
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", available: true, limits: FREE_LIMITS, features: [] },
  // Draft values: see the Project doc plans/pricing-and-plans.md. Not on sale yet.
  pro: {
    id: "pro",
    name: "Pro",
    available: false,
    limits: { ...FREE_LIMITS, activeShares: 2000, uploadsPerHour: 120, computers: 50, expiryDays: [1, 7, 30, 90, 365], maxExpiryDays: 365 },
    features: ["password_links", "custom_expiry", "no_expiry", "branded_reports", "link_insights", "pr_links"],
  },
  team: {
    id: "team",
    name: "Team",
    available: false,
    limits: { ...FREE_LIMITS, activeShares: 10000, uploadsPerHour: 600, computers: 500, expiryDays: [1, 7, 30, 90, 365], maxExpiryDays: 365 },
    features: ["password_links", "custom_expiry", "no_expiry", "branded_reports", "link_insights", "pr_links", "team_workspace"],
  },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "free" || v === "pro" || v === "team";
}
