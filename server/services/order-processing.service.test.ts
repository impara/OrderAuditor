import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getOrderByShopifyId: vi.fn(),
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    getSettings: vi.fn(),
  },
  duplicateDetectionService: { findDuplicates: vi.fn() },
  shopifyService: { tagOrder: vi.fn() },
  notificationService: {
    sendNotifications: vi.fn(),
    sendQuotaExceededNotification: vi.fn(),
  },
  subscriptionService: { checkQuota: vi.fn(), recordOrder: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("./duplicate-detection.service", () => ({
  duplicateDetectionService: mocks.duplicateDetectionService,
}));
vi.mock("./shopify.service", () => ({ shopifyService: mocks.shopifyService }));
vi.mock("./notification.service", () => ({
  notificationService: mocks.notificationService,
}));
vi.mock("./subscription.service", () => ({
  subscriptionService: mocks.subscriptionService,
}));
vi.mock("../utils/logger", () => ({ logger: mocks.logger }));

import { processOrder } from "./order-processing.service";

const mappedOrder = {
  shopDomain: "test.myshopify.com",
  shopifyOrderId: "1002",
  orderNumber: "#1002",
  customerEmail: "ada@example.com",
  customerName: "Ada Lovelace",
  customerPhone: null,
  shippingAddress: null,
  lineItems: [],
  totalPrice: "10.00",
  currency: "USD",
  createdAt: new Date("2026-05-01T12:00:00.000Z"),
  isFlagged: false,
};

const storedOrder = {
  ...mappedOrder,
  id: "stored-2",
  flagSource: "historical",
  flaggedByScanRunId: "scan-1",
  flaggedAt: new Date(),
  duplicateOfOrderId: "stored-1",
  matchReason: "Same email, Same name",
  matchConfidence: 70,
  resolvedAt: null,
  resolvedBy: null,
  customerPhoneNormalized: null,
};

const duplicate = {
  ...storedOrder,
  id: "stored-1",
  shopifyOrderId: "1001",
  orderNumber: "#1001",
};

describe("processOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage.getOrderByShopifyId.mockResolvedValue(undefined);
    mocks.storage.createOrder.mockResolvedValue(storedOrder);
    mocks.storage.updateOrder.mockResolvedValue(storedOrder);
    mocks.storage.getSettings.mockResolvedValue({ enableNotifications: true });
    mocks.duplicateDetectionService.findDuplicates.mockResolvedValue({
      order: duplicate,
      matchReason: "Same email, Same name",
      confidence: 70,
    });
    mocks.subscriptionService.checkQuota.mockResolvedValue({
      allowed: true,
      subscription: { orderLimit: 50, monthlyOrderCount: 0 },
    });
    mocks.subscriptionService.recordOrder.mockResolvedValue({
      orderLimit: 50,
      monthlyOrderCount: 1,
    });
  });

  it("persists and detects in historical mode without live side effects", async () => {
    await processOrder(mappedOrder, "token", {
      mode: "historical",
      scanRunId: "scan-1",
    });

    expect(mocks.storage.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        flagSource: "historical",
        flaggedByScanRunId: "scan-1",
        isFlagged: true,
      })
    );
    expect(mocks.shopifyService.tagOrder).not.toHaveBeenCalled();
    expect(mocks.notificationService.sendNotifications).not.toHaveBeenCalled();
    expect(mocks.subscriptionService.checkQuota).not.toHaveBeenCalled();
    expect(mocks.subscriptionService.recordOrder).not.toHaveBeenCalled();
  });

  it("re-analyzes an existing unresolved order in historical mode", async () => {
    mocks.storage.getOrderByShopifyId.mockResolvedValue({
      ...storedOrder,
      isFlagged: false,
      flaggedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    });

    await processOrder(mappedOrder, "token", {
      mode: "historical",
      scanRunId: "scan-1",
    });

    expect(mocks.storage.updateOrder).toHaveBeenCalledWith(
      mappedOrder.shopDomain,
      storedOrder.id,
      expect.objectContaining({ isFlagged: true, flaggedByScanRunId: "scan-1" })
    );
  });

  it("never re-flags a resolved historical order", async () => {
    mocks.storage.getOrderByShopifyId.mockResolvedValue({
      ...storedOrder,
      isFlagged: false,
      resolvedAt: new Date(),
      resolvedBy: "manual_dashboard",
    });

    await processOrder(mappedOrder, "token", {
      mode: "historical",
      scanRunId: "scan-1",
    });

    expect(mocks.duplicateDetectionService.findDuplicates).not.toHaveBeenCalled();
    expect(mocks.storage.updateOrder).not.toHaveBeenCalled();
  });

  it("performs live side effects only after persistence", async () => {
    const calls: string[] = [];
    mocks.storage.createOrder.mockImplementation(async () => {
      calls.push("persist");
      return { ...storedOrder, flagSource: "live", flaggedByScanRunId: null };
    });
    mocks.shopifyService.tagOrder.mockImplementation(async () => {
      calls.push("tag");
    });

    await processOrder(mappedOrder, "token", { mode: "live" });

    expect(calls).toEqual(["persist", "tag"]);
    expect(mocks.notificationService.sendNotifications).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptionService.recordOrder).toHaveBeenCalledTimes(1);
  });

  it("does not tag a historical finding when a delayed live webhook arrives", async () => {
    mocks.storage.getOrderByShopifyId.mockResolvedValue({
      ...storedOrder,
      isFlagged: true,
      flagSource: "historical",
    });

    await processOrder(mappedOrder, "token", { mode: "live" });

    expect(mocks.shopifyService.tagOrder).not.toHaveBeenCalled();
    expect(mocks.subscriptionService.checkQuota).not.toHaveBeenCalled();
  });

  it("updates an unresolved row won by a concurrent live insert", async () => {
    const racedOrder = {
      ...storedOrder,
      isFlagged: false,
      flagSource: "live",
      flaggedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    mocks.storage.getOrderByShopifyId
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(racedOrder);
    mocks.storage.createOrder.mockRejectedValue(
      new Error("duplicate key value violates unique constraint")
    );

    await processOrder(mappedOrder, "token", {
      mode: "historical",
      scanRunId: "scan-1",
    });

    expect(mocks.storage.updateOrder).toHaveBeenCalledWith(
      mappedOrder.shopDomain,
      racedOrder.id,
      expect.objectContaining({
        isFlagged: true,
        flagSource: "historical",
        flaggedByScanRunId: "scan-1",
      })
    );
  });
});
