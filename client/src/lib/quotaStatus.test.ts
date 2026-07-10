import { describe, expect, it } from "vitest";
import { getQuotaStatus } from "./quotaStatus";

describe("getQuotaStatus", () => {
  it("returns hidden when subscription is missing", () => {
    expect(getQuotaStatus(undefined)).toEqual({ state: "hidden" });
  });

  it("returns hidden for paid or unlimited plans", () => {
    expect(getQuotaStatus({ tier: "paid", monthlyOrderCount: 50, orderLimit: 50 })).toEqual({
      state: "hidden",
    });
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 50, orderLimit: -1 })).toEqual({
      state: "hidden",
    });
  });

  it("returns hidden below 80 percent", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 39, orderLimit: 50 })).toEqual({
      state: "hidden",
    });
  });

  it("returns warning at 80 to 99 percent", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 40, orderLimit: 50 })).toMatchObject({
      state: "warning",
      usagePercentage: 80,
      remaining: 10,
      used: 40,
      limit: 50,
    });
  });

  it("returns exceeded at 100 percent and clamps remaining to zero", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 55, orderLimit: 50 })).toMatchObject({
      state: "exceeded",
      usagePercentage: 110,
      remaining: 0,
      used: 55,
      limit: 50,
    });
  });

  it("parses the reset date when present", () => {
    const status = getQuotaStatus({
      tier: "free",
      monthlyOrderCount: 50,
      orderLimit: 50,
      currentBillingPeriodEnd: "2026-08-01T00:00:00.000Z",
    });

    expect(status.state).toBe("exceeded");
    if (status.state !== "hidden") {
      expect(status.resetDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    }
  });
});
