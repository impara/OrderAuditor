import { describe, expect, it } from "vitest";
import { parseBillingAuditArgs } from "./billing-audit-options";

describe("parseBillingAuditArgs", () => {
  it("defaults to a dry-run audit", () => {
    expect(parseBillingAuditArgs([])).toEqual({
      applyActive: false,
      help: false,
    });
  });

  it("allows apply-active only for an explicit valid shop", () => {
    expect(
      parseBillingAuditArgs([
        "--shop=Test-Shop.myshopify.com",
        "--apply-active",
      ])
    ).toEqual({
      shop: "test-shop.myshopify.com",
      applyActive: true,
      help: false,
    });
  });

  it("rejects broad apply-active runs", () => {
    expect(() => parseBillingAuditArgs(["--apply-active"])).toThrow(
      "requires an explicit --shop"
    );
  });

  it("rejects invalid shops and unknown arguments", () => {
    expect(() => parseBillingAuditArgs(["--shop=evil.example"])).toThrow(
      "valid *.myshopify.com"
    );
    expect(() => parseBillingAuditArgs(["--delete"])).toThrow(
      "Unknown argument"
    );
  });
});
