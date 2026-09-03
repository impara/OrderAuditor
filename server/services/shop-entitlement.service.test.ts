import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "@shared/schema";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { ShopEntitlementService } from "./shop-entitlement.service";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date("2026-09-03T00:00:00Z");
  return {
    id: "sub-1",
    shopifyShopDomain: "test.myshopify.com",
    tier: "free",
    status: "active",
    monthlyOrderCount: 0,
    allTimeOrderCount: 0,
    orderLimit: 50,
    currentBillingPeriodStart: now,
    currentBillingPeriodEnd: new Date("2026-10-03T00:00:00Z"),
    shopifyChargeId: null,
    quotaExceededNotifiedAt: null,
    reviewPromptDismissedAt: null,
    reviewPromptDeferredUntil: null,
    reviewPromptResponse: null,
    reviewPromptRespondedAt: null,
    reviewPromptCtaClickedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe("ShopEntitlementService", () => {
  let service: ShopEntitlementService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ShopEntitlementService();
  });

  it("returns paid_subscription without querying the shop plan", async () => {
    const entitlement = await service.resolve(
      "test.myshopify.com",
      "token",
      makeSubscription({ tier: "paid", orderLimit: -1 })
    );

    expect(entitlement).toEqual({
      source: "paid_subscription",
      hasPaidFeatures: true,
      partnerDevelopment: false,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("grants paid features to a Partner development shop without changing local state", async () => {
    mockFetch.mockResolvedValue(
      response(200, {
        data: { shop: { plan: { partnerDevelopment: true } } },
      })
    );
    const local = makeSubscription();

    const entitlement = await service.resolve(
      "test.myshopify.com",
      "token",
      local
    );

    expect(entitlement).toEqual({
      source: "partner_development",
      hasPaidFeatures: true,
      partnerDevelopment: true,
    });
    expect(local).toMatchObject({
      tier: "free",
      status: "active",
      shopifyChargeId: null,
      orderLimit: 50,
    });
  });

  it("fails closed when the plan query fails", async () => {
    mockFetch.mockResolvedValue(response(401, { errors: "Unauthorized" }));

    await expect(
      service.resolve("test.myshopify.com", "token", makeSubscription())
    ).resolves.toEqual({
      source: "free",
      hasPaidFeatures: false,
      partnerDevelopment: false,
    });
  });

  it("re-evaluates a development-to-paid conversion on shop/update", async () => {
    mockFetch
      .mockResolvedValueOnce(
        response(200, {
          data: { shop: { plan: { partnerDevelopment: true } } },
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          data: { shop: { plan: { partnerDevelopment: false } } },
        })
      );
    const local = makeSubscription();

    const before = await service.resolve("test.myshopify.com", "token", local);
    const after = await service.handleShopUpdate(
      "test.myshopify.com",
      "token",
      local
    );

    expect(before.source).toBe("partner_development");
    expect(after).toEqual({
      source: "free",
      hasPaidFeatures: false,
      partnerDevelopment: false,
    });
    expect(local.tier).toBe("free");
    expect(local.shopifyChargeId).toBeNull();
  });

  it("does not depend on global billing test or bypass flags", async () => {
    vi.stubEnv("SHOPIFY_BILLING_TEST_MODE", "false");
    vi.stubEnv("SHOPIFY_BILLING_BYPASS", "false");
    mockFetch.mockResolvedValue(
      response(200, {
        data: { shop: { plan: { partnerDevelopment: true } } },
      })
    );

    const entitlement = await service.resolve(
      "test.myshopify.com",
      "token",
      makeSubscription()
    );

    expect(entitlement.source).toBe("partner_development");
    expect(entitlement.hasPaidFeatures).toBe(true);
  });
});
