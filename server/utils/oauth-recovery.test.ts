import { describe, expect, it } from "vitest";
import { OAuthRecoveryRegistry } from "./oauth-recovery";

describe("OAuthRecoveryRegistry", () => {
  it("allows only one automatic retry inside the TTL", () => {
    let now = 1_000;
    const registry = new OAuthRecoveryRegistry(10 * 60 * 1000, () => now);

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(false);

    now += 10 * 60 * 1000;
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
  });

  it("normalizes shop keys to lowercase", () => {
    const registry = new OAuthRecoveryRegistry();

    expect(registry.claimAutomaticRetry("Slow-Shop.MyShopify.Com")).toBe(true);
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(false);
  });

  it("allows another retry after recovery state is cleared", () => {
    const registry = new OAuthRecoveryRegistry();

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
    registry.clear("SLOW-SHOP.MYSHOPIFY.COM");
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
  });
});
