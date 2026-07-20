import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./shopify-billing.service", () => {
  class BillingSnapshotError extends Error {
    constructor(message: string, readonly status?: number) {
      super(message);
      this.name = "BillingSnapshotError";
    }
  }
  return { BillingSnapshotError, shopifyBillingService: {} };
});

vi.mock("./subscription.service", () => ({ subscriptionService: {} }));

import { BillingSnapshotError } from "./shopify-billing.service";
import { BillingReconciliationService } from "./billing-reconciliation.service";

const PERIOD_END = "2026-08-17T13:09:59Z";
const ACTIVE_ID = "gid://shopify/AppSubscription/37757518115";

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  const active = {
    id: ACTIVE_ID,
    name: "Duplicate Guard - Unlimited Plan",
    status: "ACTIVE" as const,
    createdAt: "2026-03-20T13:09:53Z",
    currentPeriodEnd: PERIOD_END,
    test: false,
    ...overrides,
  };
  return { active: [active], history: [active], fetchedAt: new Date() };
}

function localSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    shopifyShopDomain: "test.myshopify.com",
    tier: "free" as const,
    status: "active" as const,
    monthlyOrderCount: 0,
    allTimeOrderCount: 0,
    orderLimit: 50,
    currentBillingPeriodStart: new Date("2026-07-01T00:00:00Z"),
    currentBillingPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    shopifyChargeId: null,
    quotaExceededNotifiedAt: null,
    reviewPromptDismissedAt: null,
    reviewPromptDeferredUntil: null,
    reviewPromptResponse: null,
    reviewPromptRespondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("BillingReconciliationService", () => {
  const billing = { getBillingSnapshot: vi.fn() };
  const subscriptions = {
    getSubscription: vi.fn(),
    activatePaidSubscription: vi.fn(),
  };
  let service: BillingReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    billing.getBillingSnapshot.mockResolvedValue(activeSnapshot());
    subscriptions.getSubscription.mockResolvedValue(localSubscription());
    subscriptions.activatePaidSubscription.mockResolvedValue(
      localSubscription({ tier: "paid", orderLimit: -1 })
    );
    service = new BillingReconciliationService(billing, subscriptions as any);
  });

  it("repairs a local free record from one verified active subscription", async () => {
    const result = await service.reconcileActive(
      "test.myshopify.com",
      "token"
    );

    expect(result.kind).toBe("synced_active");
    expect(subscriptions.activatePaidSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      "37757518115",
      "token",
      new Date(PERIOD_END)
    );
  });

  it("does not write when local state already matches Shopify", async () => {
    subscriptions.getSubscription.mockResolvedValue(
      localSubscription({
        tier: "paid",
        orderLimit: -1,
        shopifyChargeId: "37757518115",
        currentBillingPeriodEnd: new Date(PERIOD_END),
      })
    );

    const result = await service.reconcileActive("test.myshopify.com", "token");

    expect(result.kind).toBe("already_consistent");
    expect(subscriptions.activatePaidSubscription).not.toHaveBeenCalled();
  });

  it("reports drift without writing in dry-run mode", async () => {
    const result = await service.reconcileActive(
      "test.myshopify.com",
      "token",
      { apply: false }
    );

    expect(result.kind).toBe("would_sync_active");
    expect(subscriptions.activatePaidSubscription).not.toHaveBeenCalled();
  });

  it("does not mutate when multiple subscriptions are active", async () => {
    const first = activeSnapshot().active[0];
    billing.getBillingSnapshot.mockResolvedValue({
      ...activeSnapshot(),
      active: [
        first,
        { ...first, id: "gid://shopify/AppSubscription/37757485347" },
      ],
    });

    const result = await service.reconcileActive("test.myshopify.com", "token");

    expect(result.kind).toBe("multiple_active");
    expect(subscriptions.activatePaidSubscription).not.toHaveBeenCalled();
  });

  it("does not mutate a successfully verified zero-active state", async () => {
    billing.getBillingSnapshot.mockResolvedValue({
      active: [],
      history: [
        {
          ...activeSnapshot().active[0],
          status: "EXPIRED",
          currentPeriodEnd: null,
        },
      ],
      fetchedAt: new Date(),
    });

    const result = await service.reconcileActive("test.myshopify.com", "token");

    expect(result).toEqual({ kind: "no_active", latestStatus: "EXPIRED" });
    expect(subscriptions.activatePaidSubscription).not.toHaveBeenCalled();
  });

  it("does not mutate when Shopify cannot be verified", async () => {
    billing.getBillingSnapshot.mockRejectedValue(
      new BillingSnapshotError("Shopify billing query returned HTTP 401", 401)
    );

    const result = await service.reconcileActive("test.myshopify.com", "token");

    expect(result.kind).toBe("unverified");
    expect(subscriptions.activatePaidSubscription).not.toHaveBeenCalled();
  });
});
