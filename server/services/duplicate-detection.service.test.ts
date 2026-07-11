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
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
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

  it("flags a warm household collision when email and name differ but address and SKU overlap", async () => {
    const settings = {
      shopDomain: "test.myshopify.com",
      timeWindowHours: 24,
      matchEmail: true,
      matchPhone: false,
      matchAddress: true,
      matchSku: true,
    };

    const matchingAddress = {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
      country: "US",
    };
    const existingOrder = buildOrder({
      customerEmail: "first@example.com",
      customerName: "Ada Lovelace",
      shippingAddress: matchingAddress,
      lineItems: [
        {
          id: "line-item-1",
          sku: "SAMPLE-KIT",
          title: "Free Sample Kit",
          quantity: 1,
          price: "0.00",
        },
      ],
    });
    const unrelatedOrder = buildOrder({
      id: "unrelated-order-id",
      shopifyOrderId: "1000",
      orderNumber: "#1000",
      customerEmail: "other@example.com",
      customerName: "Grace Hopper",
      shippingAddress: {
        address1: "999 Side St",
        city: "New York",
        zip: "10001",
        country: "US",
      },
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
      .mockReturnValueOnce(buildQueryStub([]))
      .mockReturnValueOnce(buildQueryStub([unrelatedOrder, existingOrder]));

    const result = await service.findDuplicates(
      {
        shopDomain: "test.myshopify.com",
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerEmail: "second@example.com",
        customerName: "A. Lovelace",
        customerPhone: null,
        shippingAddress: matchingAddress,
        totalPrice: "0.00",
        currency: "USD",
        createdAt: new Date(),
        isFlagged: false,
        lineItems: [
          {
            id: "line-item-2",
            sku: "SAMPLE-KIT",
            title: "Free Sample Kit",
            quantity: 1,
            price: "0.00",
          },
        ],
      },
      "test.myshopify.com"
    );

    expect(result).toEqual({
      order: existingOrder,
      matchReason: "Same address, Same SKU purchased",
      confidence: 100,
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

  it("anchors the duplicate window to an old order timestamp", async () => {
    const referenceTime = new Date("2026-05-01T12:00:00.000Z");
    const existingOrder = buildOrder({
      customerEmail: "ada@example.com",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    mockSelect
      .mockReturnValueOnce(buildQueryStub([{
        shopDomain: "test.myshopify.com",
        timeWindowHours: 24,
        matchEmail: true,
        matchPhone: false,
        matchAddress: false,
        matchSku: false,
      }]))
      .mockReturnValueOnce(buildQueryStub([existingOrder]));

    const result = await service.findDuplicates(
      {
        ...buildOrder({ id: undefined }),
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerEmail: "ada@example.com",
        createdAt: referenceTime,
      },
      "test.myshopify.com"
    );

    expect(result?.order.id).toBe(existingOrder.id);
  });

  it.each([
    ["outside the preceding window", "2026-04-30T11:59:59.000Z", "1001"],
    ["created after the analyzed order", "2026-05-01T13:00:00.000Z", "1001"],
    ["the persisted row itself", "2026-05-01T12:00:00.000Z", "1002"],
  ])("does not match an order %s", async (_label, candidateCreatedAt, candidateShopifyId) => {
    const existingOrder = buildOrder({
      shopifyOrderId: candidateShopifyId,
      customerEmail: "ada@example.com",
      createdAt: new Date(candidateCreatedAt),
    });

    mockSelect
      .mockReturnValueOnce(buildQueryStub([{
        shopDomain: "test.myshopify.com",
        timeWindowHours: 24,
        matchEmail: true,
        matchPhone: false,
        matchAddress: false,
        matchSku: false,
      }]))
      .mockReturnValueOnce(buildQueryStub([existingOrder]));

    const result = await service.findDuplicates(
      {
        ...buildOrder({ id: undefined }),
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerEmail: "ada@example.com",
        createdAt: new Date("2026-05-01T12:00:00.000Z"),
      },
      "test.myshopify.com"
    );

    expect(result).toBeNull();
  });

  it("does not use Unknown customer names to turn a SKU-only match into a flag", async () => {
    const existingOrder = buildOrder({ customerName: "Unknown" });
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{
        shopDomain: "test.myshopify.com",
        timeWindowHours: 24,
        matchEmail: false,
        matchPhone: false,
        matchAddress: false,
        matchSku: true,
      }]))
      .mockReturnValueOnce(buildQueryStub([existingOrder]));

    const result = await service.findDuplicates(
      {
        ...buildOrder({ id: undefined }),
        shopifyOrderId: "1002",
        orderNumber: "#1002",
        customerName: "Unknown",
      },
      "test.myshopify.com"
    );

    expect(result).toBeNull();
  });

  it("reports fuzzy-candidate truncation only when more than the cap exists", async () => {
    const candidates = Array.from({ length: 501 }, (_, index) =>
      buildOrder({
        id: `candidate-${index}`,
        shopifyOrderId: String(2000 + index),
      })
    );
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{
        shopDomain: "test.myshopify.com",
        timeWindowHours: 24,
        matchEmail: false,
        matchPhone: false,
        matchAddress: false,
        matchSku: true,
      }]))
      .mockReturnValueOnce(buildQueryStub(candidates));
    const metadata = { candidateCapExceeded: false };

    await service.findDuplicates(
      {
        ...buildOrder({ id: undefined }),
        shopifyOrderId: "1002",
        orderNumber: "#1002",
      },
      "test.myshopify.com",
      metadata
    );

    expect(metadata.candidateCapExceeded).toBe(true);
  });
});
