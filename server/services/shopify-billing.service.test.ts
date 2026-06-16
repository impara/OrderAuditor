/**
 * Regression tests for shopify-billing.service.ts
 *
 * Guards against:
 * - Double cancellation bug: cancelCharge() must NOT call cancelSubscription()
 *   internally — that responsibility belongs to the route handler
 * - cancelCharge() returns true on API success, false on failure
 * - activateCharge() upgrades subscription to paid tier
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist storage + subscriptionService mocks
// ---------------------------------------------------------------------------
const { cancelSubscription, updateTier, activatePaidSubscription } = vi.hoisted(() => ({
  cancelSubscription: vi.fn(),
  updateTier: vi.fn(),
  activatePaidSubscription: vi.fn(),
}));

vi.mock("./subscription.service", () => ({
  subscriptionService: {
    cancelSubscription,
    updateTier,
    activatePaidSubscription,
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { ShopifyBillingService } from "./shopify-billing.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResponse(status: number, body: any = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers(),
    clone: () => makeResponse(status, body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ShopifyBillingService — double cancellation regression", () => {
  let service: ShopifyBillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure billing bypass is off so we go through real code paths
    vi.stubEnv("SHOPIFY_BILLING_BYPASS", "false");
    service = new ShopifyBillingService();
  });

  // -------------------------------------------------------------------------
  // The critical regression: cancelCharge must NOT cancel the subscription
  // -------------------------------------------------------------------------

  it("does NOT call cancelSubscription() when charge cancellation succeeds", async () => {
    mockFetch.mockResolvedValue(makeResponse(200));

    const result = await service.cancelCharge(
      "test.myshopify.com",
      "shpat_testtoken",
      12345
    );

    expect(result).toBe(true);
    // This is the key regression guard — the service must not own this side effect
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("does NOT call cancelSubscription() when charge cancellation fails", async () => {
    mockFetch.mockResolvedValue(makeResponse(404, { errors: "Not found" }));

    const result = await service.cancelCharge(
      "test.myshopify.com",
      "shpat_testtoken",
      99999
    );

    expect(result).toBe(false);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("returns false without calling fetch when credentials are missing", async () => {
    const result = await service.cancelCharge("", "", 12345);

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // activateCharge: must upgrade subscription to paid
  // -------------------------------------------------------------------------

  it("upgrades subscription to paid tier on successful charge activation", async () => {
    mockFetch.mockResolvedValue(
      makeResponse(200, {
        recurring_application_charge: { id: 42, status: "ACTIVE" },
      })
    );
    updateTier.mockResolvedValue({});
    activatePaidSubscription.mockResolvedValue({});

    const result = await service.activateCharge(
      "test.myshopify.com",
      "shpat_testtoken",
      42
    );

    expect(result).toBe(true);
    expect(activatePaidSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      42
    );
    expect(updateTier).not.toHaveBeenCalled();
  });

  it("does NOT upgrade subscription when charge activation fails", async () => {
    mockFetch.mockResolvedValue(makeResponse(422, { errors: "Invalid" }));

    const result = await service.activateCharge(
      "test.myshopify.com",
      "shpat_testtoken",
      42
    );

    expect(result).toBe(false);
    expect(updateTier).not.toHaveBeenCalled();
    expect(activatePaidSubscription).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bypass mode: must NOT make real fetch calls
  // -------------------------------------------------------------------------

  it("skips real Shopify API call in bypass mode and upgrades subscription", async () => {
    vi.stubEnv("SHOPIFY_BILLING_BYPASS", "true");
    activatePaidSubscription.mockResolvedValue({});

    const result = await service.activateCharge(
      "test.myshopify.com",
      "shpat_testtoken",
      12345
    );

    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled(); // no real API call
    expect(activatePaidSubscription).toHaveBeenCalledWith(
      "test.myshopify.com",
      12345
    );
    expect(updateTier).not.toHaveBeenCalled();
  });
});
