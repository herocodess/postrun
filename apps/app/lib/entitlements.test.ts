import { describe, expect, it } from "vitest";
import { billingActive, can, publicPlan, resolveEntitlements, GRACE_DAYS, type PlanRow } from "./entitlements";
import { PLANS } from "./plans";
import { DEFAULT_EXPIRY_DAYS, EXPIRY_DAYS, MAX_ACTIVE_SHARES, MAX_TOKENS, MAX_UPLOADS_PER_HOUR, parseExpiryDays, ShareError } from "./shares";

const now = new Date("2026-10-06T12:00:00Z");
const day = 86_400_000;
const row = (p: Partial<PlanRow>): PlanRow => ({ plan: "free", status: "active", current_period_end: null, overrides: {}, ...p });

describe("Free is what everyone had before plans", () => {
  it("keeps the old limits exactly", () => {
    expect(MAX_ACTIVE_SHARES).toBe(200);
    expect(MAX_UPLOADS_PER_HOUR).toBe(30);
    expect(MAX_TOKENS).toBe(20);
    expect([...EXPIRY_DAYS]).toEqual([1, 7, 30, 90]);
    expect(DEFAULT_EXPIRY_DAYS).toBe(30);
    expect([...PLANS.free.limits.expiryDays]).toEqual([1, 7, 30, 90]);
  });

  it("no row means Free with no paid features", () => {
    const e = resolveEntitlements(undefined, now);
    expect(e.plan).toBe("free");
    expect(e.source).toBe("default");
    expect(e.limits).toEqual(PLANS.free.limits);
    expect(e.features.size).toBe(0);
  });

  it("parseExpiryDays still accepts the same choices by default", () => {
    expect(parseExpiryDays(null)).toBe(30);
    expect(parseExpiryDays("7")).toBe(7);
    expect(() => parseExpiryDays("365")).toThrow(ShareError);
  });
});

describe("billing status", () => {
  it("an active paid plan applies", () => {
    const e = resolveEntitlements(row({ plan: "pro", current_period_end: new Date(now.getTime() + 20 * day) }), now);
    expect(e.plan).toBe("pro");
    expect(e.source).toBe("billing");
    expect(can(e, "password_links")).toBe(true);
    expect(e.limits.activeShares).toBeGreaterThan(MAX_ACTIVE_SHARES);
    expect(e.renews_at).toBeInstanceOf(Date);
    expect(parseExpiryDays("365", e.limits)).toBe(365);
  });

  it("past due keeps the plan through the grace period, then falls back to Free", () => {
    const end = new Date(now.getTime() - 2 * day);
    expect(billingActive(row({ plan: "pro", status: "past_due", current_period_end: end }), now)).toBe(true);
    const late = new Date(now.getTime() - (GRACE_DAYS + 1) * day);
    expect(resolveEntitlements(row({ plan: "pro", status: "past_due", current_period_end: late }), now).plan).toBe("free");
  });

  it("canceled is Free, and an unknown plan name is Free", () => {
    expect(resolveEntitlements(row({ plan: "pro", status: "canceled" }), now).plan).toBe("free");
    expect(resolveEntitlements(row({ plan: "enterprise-gold" }), now).plan).toBe("free");
  });
});

describe("overrides", () => {
  it("can grant a plan by hand (early access, comps)", () => {
    const e = resolveEntitlements(row({ overrides: { plan: "pro" } }), now);
    expect(e.plan).toBe("pro");
    expect(e.source).toBe("override");
  });

  it("only ever raise limits, never below Free", () => {
    const e = resolveEntitlements(row({ overrides: { limits: { activeShares: 10, computers: 40, expiryDays: [180] } } }), now);
    expect(e.limits.activeShares).toBe(200);
    expect(e.limits.computers).toBe(40);
    expect([...e.limits.expiryDays]).toEqual([1, 7, 30, 90, 180]);
  });

  it("ignore junk", () => {
    const e = resolveEntitlements(row({ overrides: { plan: "platinum", limits: { activeShares: -5, nonsense: 9 }, features: [42] } }), now);
    expect(e.plan).toBe("free");
    expect(e.limits).toEqual(PLANS.free.limits);
    expect(e.features.size).toBe(0);
  });

  it("can add a single feature to Free", () => {
    const e = resolveEntitlements(row({ overrides: { features: ["password_links"] } }), now);
    expect(e.plan).toBe("free");
    expect(can(e, "password_links")).toBe(true);
    expect(can(e, "branded_reports")).toBe(false);
  });
});

describe("publicPlan", () => {
  it("is a stable, snake_case shape for the API", () => {
    expect(publicPlan(resolveEntitlements(undefined, now))).toEqual({
      id: "free",
      name: "Free",
      limits: { active_shares: 200, uploads_per_hour: 30, computers: 20, expiry_days: [1, 7, 30, 90] },
      features: [],
    });
  });
});

describe("plan catalog", () => {
  it("only Free is on sale until billing ships", () => {
    expect(Object.values(PLANS).filter((p) => p.available).map((p) => p.id)).toEqual(["free"]);
  });
  it("every paid plan is at least Free on every limit", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.limits.activeShares).toBeGreaterThanOrEqual(PLANS.free.limits.activeShares);
      expect(p.limits.uploadsPerHour).toBeGreaterThanOrEqual(PLANS.free.limits.uploadsPerHour);
      expect(p.limits.computers).toBeGreaterThanOrEqual(PLANS.free.limits.computers);
      for (const d of PLANS.free.limits.expiryDays) expect(p.limits.expiryDays).toContain(d);
    }
  });
});
