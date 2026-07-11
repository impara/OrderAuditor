import { describe, expect, it } from "vitest";
import { mapShopifyOrder } from "./order-mapper.service";

describe("mapShopifyOrder", () => {
  it("maps the fields used by persistence and duplicate detection", () => {
    const result = mapShopifyOrder("test.myshopify.com", {
      id: 123,
      order_number: 1001,
      contact_email: "ada@example.com",
      customer: {
        first_name: "Ada",
        last_name: "Lovelace",
        phone: "+1 555 0100",
      },
      shipping_address: {
        address1: "123 Main St",
        city: "London",
        zip: "SW1A 1AA",
        phone: "+1 555 9999",
      },
      line_items: [{
        id: 987,
        sku: "SAMPLE",
        title: "Sample",
        quantity: 2,
        price: "0.00",
      }],
      total_price: "0.00",
      currency: "GBP",
      created_at: "2026-05-01T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      shopDomain: "test.myshopify.com",
      shopifyOrderId: "123",
      orderNumber: "1001",
      customerEmail: "ada@example.com",
      customerName: "Ada Lovelace",
      customerPhone: "+1 555 0100",
      totalPrice: "0.00",
      currency: "GBP",
      isFlagged: false,
    });
    expect(result.createdAt).toEqual(new Date("2026-05-01T12:00:00.000Z"));
    expect(result.lineItems).toEqual([{
      id: "987",
      sku: "SAMPLE",
      title: "Sample",
      quantity: 2,
      price: "0.00",
    }]);
  });

  it("uses the documented contact and phone fallbacks", () => {
    const result = mapShopifyOrder("test.myshopify.com", {
      id: "gid",
      name: "#1002",
      customer: { email: "customer@example.com" },
      billing_address: { phone: "+45 12345678" },
    });

    expect(result.customerEmail).toBe("customer@example.com");
    expect(result.customerName).toBe("Unknown");
    expect(result.customerPhone).toBe("+45 12345678");
    expect(result.orderNumber).toBe("#1002");
    expect(result.lineItems).toEqual([]);
  });
});
