import { describe, expect, it } from "vitest";
import { productEventPayloadSchema } from "./product-events";

describe("productEventPayloadSchema", () => {
  it("accepts the bounded PII-free event shapes", () => {
    expect(
      productEventPayloadSchema.parse({
        eventName: "scan_summary_viewed",
        eventKey: "0123456789abcdef0123456789abcdef",
        properties: { statusBucket: "matches_found" },
      })
    ).toEqual({
      eventName: "scan_summary_viewed",
      eventKey: "0123456789abcdef0123456789abcdef",
      properties: { statusBucket: "matches_found" },
    });
  });

  it("rejects merchant, order, and customer identifiers", () => {
    expect(
      productEventPayloadSchema.safeParse({
        eventName: "match_review_opened",
        eventKey: "0123456789abcdef0123456789abcdef",
        properties: { orderId: "gid://shopify/Order/1" },
      }).success
    ).toBe(false);

    expect(
      productEventPayloadSchema.safeParse({
        eventName: "dashboard_opened",
        eventKey: "0123456789abcdef0123456789abcdef",
        properties: { email: "merchant@example.com" },
      }).success
    ).toBe(false);
  });

  it("rejects unknown events and unsafe event keys", () => {
    expect(
      productEventPayloadSchema.safeParse({
        eventName: "customer_exported",
        eventKey: "0123456789abcdef0123456789abcdef",
        properties: {},
      }).success
    ).toBe(false);

    expect(
      productEventPayloadSchema.safeParse({
        eventName: "dashboard_opened",
        eventKey: "contains customer@example.com",
        properties: {},
      }).success
    ).toBe(false);
  });
});
