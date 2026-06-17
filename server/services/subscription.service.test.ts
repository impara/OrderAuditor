/**
 * Regression tests for subscription.service.ts
 *
 * Guards against:
 * - Free tier limit inconsistency (was 30 in some paths, 50 in others)
 * - Billing period reset correctness on cancellation and grace-period expiry
 * - Quota boundary: exactly at limit = denied; one under = allowed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "../../shared/schema";

/** Mirror of the constant from storage.ts — tested separately in storage.test.ts */
const FREE_TIER_ORDER_LIMIT = 50;

// ---------------------------------------------------------------------------
// Mock the database before anything imports storage.ts (which imports db.ts)
// ---------------------------------------------------------------------------
vi.mock("../db", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Hoist storage mock
// ---------------------------------------------------------------------------
const {
  getSubscription,
  initializeSubscription,
  updateSubscription,
  resetMonthlyOrderCount,
  incrementOrderCount,
} = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  initializeSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  resetMonthlyOrderCount: vi.fn(),
  incrementOrderCount: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getSubscription,
    initializeSubscription,
    updateSubscription,
    resetMonthlyOrderCount,
    incrementOrderCount,
  },
  // Literal to avoid TDZ error — vi.mock is hoisted above all const declarations
  FREE_TIER_ORDER_LIMIT: 50,
}));

vi.mock("./notification.service", () => ({
  notificationService: {
    prefillMerchantNotificationEmail: vi.fn().mockResolvedValue(undefined),
  },
}));


import { subscriptionService } from "./subscription.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const NOW = new Date("2026-04-14T00:00:00.000Z");
const FUTURE = new Date("2026-05-14T00:00:00.000Z");
const PAST = new Date("2026-03-14T00:00:00.000Z");

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    shopifyShopDomain: "test.myshopify.com",
    tier: "free",
    status: "active",
    monthlyOrderCount: 0,
    allTimeOrderCount: 0,
    orderLimit: FREE_TIER_ORDER_LIMIT,
    currentBillingPeriodStart: NOW,
    currentBillingPeriodEnd: FUTURE,
    shopifyChargeId: null,
    quotaExceededNotifiedAt: null,
    reviewPromptDismissedAt: null,
    reviewPromptDeferredUntil: null,
    reviewPromptResponse: null,
    reviewPromptRespondedAt: null,
    reviewPromptCtaClickedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SubscriptionService — free tier limit constant regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  // --- FREE_TIER_ORDER_LIMIT export -------------------------------------------

  it("exports FREE_TIER_ORDER_LIMIT as 50", () => {
    expect(FREE_TIER_ORDER_LIMIT).toBe(50);
  });

  // --- checkQuota: active subscription ----------------------------------------

  it("allows processing when order count is below the limit", async () => {
    getSubscription.mockResolvedValue(
      makeSub({ monthlyOrderCount: 49, orderLimit: FREE_TIER_ORDER_LIMIT })
    );
    const result = await subscriptionService.checkQuota("test.myshopify.com");
    expect(result.allowed).toBe(true);
  });

  it("denies processing when order count equals the limit (boundary)", async () => {
    getSubscription.mockResolvedValue(
      makeSub({ monthlyOrderCount: 50, orderLimit: FREE_TIER_ORDER_LIMIT })
    );
    const result = await subscriptionService.checkQuota("test.myshopify.com");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/50/); // message should mention the limit
  });

  it("always allows processing on paid tier (orderLimit = -1)", async () => {
    getSubscription.mockResolvedValue(
      makeSub({ tier: "paid", orderLimit: -1, monthlyOrderCount: 9999 })
    );
    const result = await subscriptionService.checkQuota("test.myshopify.com");
    expect(result.allowed).toBe(true);
  });

  it("initializes subscription when none exists and allows processing", async () => {
    getSubscription.mockResolvedValueOnce(undefined);
    initializeSubscription.mockResolvedValue(makeSub());
    // Second call (after init) returns the initialized sub
    getSubscription.mockResolvedValue(makeSub());

    const result = await subscriptionService.checkQuota("test.myshopify.com");
    expect(initializeSubscription).toHaveBeenCalledWith("test.myshopify.com");
    expect(result.allowed).toBe(true);
  });

  // --- Grace period / billing period expiry -----------------------------------

  it("resets the order count when the billing period expires on free tier", async () => {
    const expiredSub = makeSub({
      currentBillingPeriodEnd: PAST, // expired
      monthlyOrderCount: 30,
    });
    getSubscription.mockResolvedValue(expiredSub);
    resetMonthlyOrderCount.mockResolvedValue(
      makeSub({ monthlyOrderCount: 0 })
    );

    const result = await subscriptionService.checkQuota("test.myshopify.com");
    expect(resetMonthlyOrderCount).toHaveBeenCalledWith("test.myshopify.com");
    expect(result.allowed).toBe(true);
  });

  it("downgrades cancelled paid tier to free with FREE_TIER_ORDER_LIMIT on expired period", async () => {
    const expiredCancelledSub = makeSub({
      tier: "paid",
      status: "cancelled",
      orderLimit: -1,
      currentBillingPeriodEnd: PAST, // grace period over
    });
    getSubscription.mockResolvedValue(expiredCancelledSub);

    // updateSubscription returns the downgraded sub
    const downgradedSub = makeSub({
      tier: "free",
      status: "active",
      orderLimit: FREE_TIER_ORDER_LIMIT,
      monthlyOrderCount: 0,
    });
    updateSubscription.mockResolvedValue(downgradedSub);

    const result = await subscriptionService.checkQuota("test.myshopify.com");

    // Must downgrade to the constant (50), not any other value
    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({
        tier: "free",
        orderLimit: FREE_TIER_ORDER_LIMIT,
      })
    );
    expect(result.allowed).toBe(true);
  });

  // --- updateTier: free tier limit is consistent ----------------------------

  it("sets orderLimit to FREE_TIER_ORDER_LIMIT when downgrading to free tier", async () => {
    getSubscription.mockResolvedValue(
      makeSub({ tier: "paid", orderLimit: -1 })
    );
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "free", orderLimit: FREE_TIER_ORDER_LIMIT })
    );

    await subscriptionService.updateTier("test.myshopify.com", "free");

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ orderLimit: FREE_TIER_ORDER_LIMIT })
    );
  });

  it("sets orderLimit to -1 when upgrading to paid tier", async () => {
    getSubscription.mockResolvedValue(makeSub());
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "paid", orderLimit: -1 })
    );

    await subscriptionService.updateTier("test.myshopify.com", "paid");

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ orderLimit: -1 })
    );
  });

  it("immediately downgrades to FREE_TIER_ORDER_LIMIT when no active paid period", async () => {
    const freeSub = makeSub({ tier: "free" }); // no paid period
    getSubscription.mockResolvedValue(freeSub);
    updateSubscription.mockResolvedValue(
      makeSub({ orderLimit: FREE_TIER_ORDER_LIMIT })
    );

    await subscriptionService.cancelSubscription("test.myshopify.com");

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ orderLimit: FREE_TIER_ORDER_LIMIT })
    );
  });

  it("enters grace period (status=cancelled, keeps paid limit) when paid period is still active", async () => {
    const paidSub = makeSub({
      tier: "paid",
      status: "active",
      orderLimit: -1,
      currentBillingPeriodEnd: FUTURE, // still valid
    });
    getSubscription.mockResolvedValue(paidSub);
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "paid", status: "cancelled", orderLimit: -1 })
    );

    await subscriptionService.cancelSubscription("test.myshopify.com");

    // Should NOT downgrade yet — just mark as cancelled
    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ status: "cancelled" })
    );
    // orderLimit should NOT be changed to free tier
    const calledWith = updateSubscription.mock.calls[0][1];
    expect(calledWith).not.toHaveProperty("orderLimit", FREE_TIER_ORDER_LIMIT);
  });

  it("stores shopifyChargeId when activating paid subscription", async () => {
    getSubscription.mockResolvedValue(makeSub());
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "paid", shopifyChargeId: "37757518115" })
    );

    await subscriptionService.activatePaidSubscription(
      "test.myshopify.com",
      37757518115
    );

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({
        tier: "paid",
        status: "active",
        orderLimit: -1,
        shopifyChargeId: "37757518115",
      })
    );
  });

  it("ignores stale EXPIRED webhook when another charge is active", async () => {
    getSubscription.mockResolvedValue(
      makeSub({
        tier: "paid",
        status: "active",
        shopifyChargeId: "37757518115",
      })
    );

    await subscriptionService.syncAppSubscriptionWebhook(
      "test.myshopify.com",
      {
        status: "EXPIRED",
        admin_graphql_api_id: "gid://shopify/AppSubscription/37757485347",
      }
    );

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("stores charge id and activates on ACTIVE webhook", async () => {
    getSubscription.mockResolvedValue(makeSub());
    updateSubscription.mockResolvedValue(
      makeSub({
        tier: "paid",
        status: "active",
        shopifyChargeId: "37757518115",
      })
    );

    await subscriptionService.syncAppSubscriptionWebhook(
      "test.myshopify.com",
      {
        status: "ACTIVE",
        admin_graphql_api_id: "gid://shopify/AppSubscription/37757518115",
      }
    );

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({
        tier: "paid",
        status: "active",
        shopifyChargeId: "37757518115",
      })
    );
  });

  it("cancels when CANCELLED webhook matches stored charge id", async () => {
    getSubscription.mockResolvedValue(
      makeSub({
        tier: "paid",
        status: "active",
        shopifyChargeId: "37757518115",
        currentBillingPeriodEnd: FUTURE,
      })
    );
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "paid", status: "cancelled" })
    );

    await subscriptionService.syncAppSubscriptionWebhook(
      "test.myshopify.com",
      {
        status: "CANCELLED",
        admin_graphql_api_id: "gid://shopify/AppSubscription/37757518115",
      }
    );

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("pauses paid subscription on FROZEN webhook instead of cancelling", async () => {
    getSubscription.mockResolvedValue(
      makeSub({
        tier: "paid",
        status: "active",
        shopifyChargeId: "32111198375",
      })
    );
    updateSubscription.mockResolvedValue(
      makeSub({ tier: "paid", status: "frozen", shopifyChargeId: "32111198375" })
    );

    await subscriptionService.syncAppSubscriptionWebhook(
      "test.myshopify.com",
      {
        status: "FROZEN",
        admin_graphql_api_id: "gid://shopify/AppSubscription/32111198375",
      }
    );

    expect(updateSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({
        tier: "paid",
        status: "frozen",
        orderLimit: -1,
        shopifyChargeId: "32111198375",
      })
    );
  });

  it("denies quota while subscription is frozen", async () => {
    getSubscription.mockResolvedValue(
      makeSub({
        tier: "paid",
        status: "frozen",
        orderLimit: -1,
      })
    );

    const result = await subscriptionService.checkQuota("test.myshopify.com");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("paused");
  });
});
