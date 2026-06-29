import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    tryRecordWebhookDelivery: vi.fn(),
    recordWebhookDelivery: vi.fn(),
    markWebhookDeliveryQueued: vi.fn(),
    markWebhookDeliveryProcessing: vi.fn(),
    markWebhookDeliveryProcessed: vi.fn(),
    markWebhookDeliveryFailed: vi.fn(),
    getOrderByShopifyId: vi.fn(),
    createOrder: vi.fn(),
    getSettings: vi.fn(),
  },
  shopifyService: {
    getOrder: vi.fn(),
    getCustomer: vi.fn(),
    tagOrder: vi.fn(),
  },
  duplicateDetectionService: {
    findDuplicates: vi.fn(),
  },
  notificationService: {
    sendNotifications: vi.fn(),
    sendQuotaExceededNotification: vi.fn(),
  },
  subscriptionService: {
    checkQuota: vi.fn(),
    recordOrder: vi.fn(),
  },
  shopify: {
    session: {
      getOfflineId: vi.fn(),
    },
    config: {
      sessionStorage: {
        loadSession: vi.fn(),
      },
    },
  },
  getOfflineAccessToken: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: mocks.storage,
}));

vi.mock("./shopify.service", () => ({
  shopifyService: mocks.shopifyService,
}));

vi.mock("./duplicate-detection.service", () => ({
  duplicateDetectionService: mocks.duplicateDetectionService,
}));

vi.mock("./notification.service", () => ({
  notificationService: mocks.notificationService,
}));

vi.mock("./subscription.service", () => ({
  subscriptionService: mocks.subscriptionService,
}));

vi.mock("../shopify-auth", () => ({
  shopify: mocks.shopify,
  getOfflineAccessToken: mocks.getOfflineAccessToken,
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

import {
  buildOrderCreateDeliveryId,
  buildOrderCreateJobKey,
  webhookProcessor,
} from "./webhook-processor.service";

const baseJobData = {
  shopDomain: "test.myshopify.com",
  deliveryId: "delivery-1",
  accessToken: "shpat_test_token",
  webhookTopic: "orders/create",
  payload: {
    id: 123,
    order_number: 1001,
    email: "ada@example.com",
    customer: {
      first_name: "Ada",
      last_name: "Lovelace",
    },
    shipping_address: {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
    },
    line_items: [
      {
        id: "line-1",
        sku: "SKU-123",
        title: "Test product",
        quantity: 1,
        price: "25.00",
      },
    ],
    total_price: "25.00",
    currency: "USD",
    created_at: "2026-05-09T10:00:00.000Z",
  },
};

describe("buildOrderCreateDeliveryId", () => {
  it("uses Shopify's delivery header when present", () => {
    expect(
      buildOrderCreateDeliveryId("test.myshopify.com", 123, " delivery-1 ")
    ).toBe("delivery-1");
  });

  it("falls back to a stable shop/order key when Shopify omits delivery headers", () => {
    expect(buildOrderCreateDeliveryId("test.myshopify.com", 123, "")).toBe(
      "orders/create:test.myshopify.com:123"
    );
  });
});

describe("buildOrderCreateJobKey", () => {
  it("always uses the stable shop/order key for queue idempotency", () => {
    expect(buildOrderCreateJobKey("test.myshopify.com", 123)).toBe(
      "orders/create:test.myshopify.com:123"
    );
  });
});

describe("WebhookProcessorService.processOrderCreate idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.storage.recordWebhookDelivery.mockResolvedValue(undefined);
    mocks.storage.markWebhookDeliveryQueued.mockResolvedValue(undefined);
    mocks.storage.markWebhookDeliveryProcessing.mockResolvedValue(undefined);
    mocks.storage.markWebhookDeliveryProcessed.mockResolvedValue(undefined);
    mocks.storage.markWebhookDeliveryFailed.mockResolvedValue(undefined);
    mocks.storage.getOrderByShopifyId.mockResolvedValue(undefined);
    mocks.storage.createOrder.mockResolvedValue({ id: "order-row-id" });
    mocks.subscriptionService.checkQuota.mockResolvedValue({ allowed: true });
    mocks.subscriptionService.recordOrder.mockResolvedValue({
      orderLimit: -1,
      monthlyOrderCount: 1,
    });
    mocks.duplicateDetectionService.findDuplicates.mockResolvedValue(null);
    mocks.shopify.session.getOfflineId.mockReturnValue("offline_test.myshopify.com");
    mocks.shopify.config.sessionStorage.loadSession.mockResolvedValue({
      accessToken: "shpat_loaded_token",
    });
    mocks.getOfflineAccessToken.mockResolvedValue("shpat_loaded_token");
  });

  it("does not treat an existing webhook delivery row as a completed order", async () => {
    mocks.storage.tryRecordWebhookDelivery.mockRejectedValue(
      new Error("tryRecord should not be called")
    );

    await expect(
      webhookProcessor.processOrderCreate(baseJobData)
    ).resolves.toBeUndefined();

    expect(mocks.storage.tryRecordWebhookDelivery).not.toHaveBeenCalled();
    expect(mocks.storage.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: "test.myshopify.com",
        shopifyOrderId: "123",
      })
    );
    expect(mocks.storage.markWebhookDeliveryProcessing).toHaveBeenCalledWith({
      shopDomain: "test.myshopify.com",
      deliveryId: "delivery-1",
      topic: "orders/create",
    });
    expect(mocks.storage.markWebhookDeliveryProcessed).toHaveBeenCalledWith({
      shopDomain: "test.myshopify.com",
      deliveryId: "delivery-1",
      topic: "orders/create",
    });
  });

  it("marks delivery processed when the order already exists", async () => {
    mocks.storage.getOrderByShopifyId.mockResolvedValue({
      id: "order-row-id",
      shopifyOrderId: "123",
      isFlagged: false,
    });

    await expect(
      webhookProcessor.processOrderCreate(baseJobData)
    ).resolves.toBeUndefined();

    expect(mocks.duplicateDetectionService.findDuplicates).not.toHaveBeenCalled();
    expect(mocks.storage.createOrder).not.toHaveBeenCalled();
    expect(mocks.storage.markWebhookDeliveryProcessed).toHaveBeenCalledWith({
      shopDomain: "test.myshopify.com",
      deliveryId: "delivery-1",
      topic: "orders/create",
    });
  });

  it("treats duplicate order insert errors as idempotent success", async () => {
    mocks.storage.createOrder.mockRejectedValue(
      new Error("duplicate key value violates unique constraint")
    );

    await expect(
      webhookProcessor.processOrderCreate(baseJobData)
    ).resolves.toBeUndefined();

    expect(mocks.storage.markWebhookDeliveryProcessed).toHaveBeenCalledWith({
      shopDomain: "test.myshopify.com",
      deliveryId: "delivery-1",
      topic: "orders/create",
    });
  });

  it("sends quota exceeded notification when quota blocks processing at 100%", async () => {
    mocks.subscriptionService.checkQuota.mockResolvedValue({
      allowed: false,
      reason: "Monthly duplicate flag limit (50) reached. Upgrade to Unlimited to keep flagging duplicate-looking orders this cycle.",
      subscription: {
        orderLimit: 50,
        monthlyOrderCount: 50,
        quotaExceededNotifiedAt: null,
        currentBillingPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      },
    });

    await expect(
      webhookProcessor.processOrderCreate(baseJobData)
    ).resolves.toBeUndefined();

    expect(mocks.notificationService.sendQuotaExceededNotification).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({
        orderLimit: 50,
        monthlyOrderCount: 50,
      })
    );
    expect(mocks.storage.createOrder).not.toHaveBeenCalled();
    expect(mocks.storage.markWebhookDeliveryProcessed).toHaveBeenCalled();
  });

  it("throws when no access token is available so pg-boss can retry", async () => {
    mocks.shopify.config.sessionStorage.loadSession.mockResolvedValue(null);
    mocks.getOfflineAccessToken.mockResolvedValue(null);

    await expect(
      webhookProcessor.processOrderCreate({
        ...baseJobData,
        accessToken: "",
      })
    ).rejects.toThrow("No access token available");

    expect(mocks.storage.markWebhookDeliveryProcessed).not.toHaveBeenCalled();
    expect(mocks.storage.markWebhookDeliveryFailed).toHaveBeenCalledWith(
      {
        shopDomain: "test.myshopify.com",
        deliveryId: "delivery-1",
        topic: "orders/create",
      },
      expect.any(Error)
    );
    expect(mocks.storage.createOrder).not.toHaveBeenCalled();
  });
});
