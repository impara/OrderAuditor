import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  db: {
    select: mockSelect,
  },
}));

import { DuplicateDetectionService } from "./duplicate-detection.service";

function buildQueryStub(rows: any[]) {
  const stub: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (value: any[]) => void) => Promise.resolve(rows).then(resolve),
  };
  return stub;
}

describe("DuplicateDetectionService.findDuplicates", () => {
  let service: DuplicateDetectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DuplicateDetectionService();
  });

  function buildOrder(overrides: Record<string, any> = {}) {
    return {
      id: "existing-order-id",
      shopDomain: "test.myshopify.com",
      shopifyOrderId: "1001",
      orderNumber: "#1001",
      customerEmail: null,
      customerName: "Ada Lovelace",
      customerPhone: null,
      shippingAddress: null,
      totalPrice: "25.00",
      currency: "USD",
      createdAt: new Date(),
      isFlagged: false,
      flaggedAt: null,
      duplicateOfOrderId: null,
      matchReason: null,
      matchConfidence: null,
      resolvedAt: null,
      resolvedBy: null,
      lineItems: [
        {
          id: "line-item-1",
          sku: "SKU-123",
          title: "Test product",
          quantity: 1,
          price: "25.00",
        },
      ],
      ...overrides,
    };
  }

  it("uses time-window candidates when SKU matching is enabled and email/phone are unavailable", async () => {
    const settings = {
      shopDomain: "test.myshopify.com",
      timeWindowHours: 24,
      matchEmail: false,
      matchPhone: false,
      matchAddress: false,
      matchSku: true,
    };

    const existingOrder = buildOrder();
    const unrelatedOrder = buildOrder({
      id: "unrelated-order-id",
      shopifyOrderId: "1000",
      orderNumber: "#1000",
      customerName: "Ada Lovelace",
      lineItems: [
        {
          id: "line-item-0",
          sku: "OTHER-SKU",
          title: "Other product",
          quantity: 1,
          price: "25.00",
        },
      ],
    });

    mockSelect
      .mockReturnValueOnce(buildQueryStub([settings]))
      .mockReturnValueOnce(buildQueryStub([unrelatedOrder, existingOrder]));

    const result = await service.findDuplicates(
      {
        shopDomain: "test.myshopify.com",
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerEmail: null,
        customerName: "Ada Lovelace",
        customerPhone: null,
        shippingAddress: null,
        totalPrice: "25.00",
        currency: "USD",
        createdAt: new Date(),
        isFlagged: false,
        lineItems: [
          {
            id: "line-item-2",
            sku: "SKU-123",
            title: "Test product",
            quantity: 1,
            price: "25.00",
          },
        ],
      },
      "test.myshopify.com"
    );

    expect(result).toEqual({
      order: existingOrder,
      matchReason: "Same name, Same SKU purchased",
      confidence: 70,
    });
  });

  it("uses address candidates when address matching is enabled and email/phone are unavailable", async () => {
    const settings = {
      shopDomain: "test.myshopify.com",
      timeWindowHours: 24,
      matchEmail: false,
      matchPhone: false,
      matchAddress: true,
      matchSku: false,
    };

    const matchingAddress = {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
      country: "US",
    };
    const existingOrder = buildOrder({
      shippingAddress: matchingAddress,
      lineItems: null,
    });
    const unrelatedOrder = buildOrder({
      id: "unrelated-order-id",
      shopifyOrderId: "1000",
      orderNumber: "#1000",
      customerName: "Ada Lovelace",
      shippingAddress: {
        address1: "999 Side St",
        city: "New York",
        zip: "10001",
        country: "US",
      },
      lineItems: null,
    });

    mockSelect
      .mockReturnValueOnce(buildQueryStub([settings]))
      .mockReturnValueOnce(buildQueryStub([unrelatedOrder, existingOrder]));

    const result = await service.findDuplicates(
      {
        shopDomain: "test.myshopify.com",
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerEmail: null,
        customerName: "Ada Lovelace",
        customerPhone: null,
        shippingAddress: matchingAddress,
        totalPrice: "25.00",
        currency: "USD",
        createdAt: new Date(),
        isFlagged: false,
        lineItems: null,
      },
      "test.myshopify.com"
    );

    expect(result).toEqual({
      order: existingOrder,
      matchReason: "Same address, Same name",
      confidence: 70,
    });
  });
});
