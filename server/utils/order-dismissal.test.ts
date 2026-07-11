import { describe, expect, it } from "vitest";
import { shouldRemoveShopifyTag } from "./order-dismissal";

describe("shouldRemoveShopifyTag", () => {
  it("keeps historical dismissals read-only in Shopify", () => {
    expect(shouldRemoveShopifyTag("historical")).toBe(false);
  });

  it("preserves tag removal for live findings", () => {
    expect(shouldRemoveShopifyTag("live")).toBe(true);
  });
});
