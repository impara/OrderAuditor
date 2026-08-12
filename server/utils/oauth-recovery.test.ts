import { describe, expect, it } from "vitest";
import { OAuthRecoveryRegistry } from "./oauth-recovery";

describe("OAuthRecoveryRegistry", () => {
  it("allows only one automatic retry inside the TTL", () => {
    let now = 1_000;
    const registry = new OAuthRecoveryRegistry(10 * 60 * 1000, () => now);

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe("claimed");
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(
      "already_claimed"
    );

    now += 10 * 60 * 1000;
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe("claimed");
  });

  it("normalizes shop keys to lowercase", () => {
    const registry = new OAuthRecoveryRegistry();

    expect(registry.claimAutomaticRetry("Slow-Shop.MyShopify.Com")).toBe("claimed");
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(
      "already_claimed"
    );
  });

  it("allows another retry after recovery state is cleared", () => {
    const registry = new OAuthRecoveryRegistry();

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe("claimed");
    registry.clear("SLOW-SHOP.MYSHOPIFY.COM");
    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe("claimed");
  });

  it("rejects new unique shops when active recovery state reaches capacity", () => {
    const registry = new OAuthRecoveryRegistry(10 * 60 * 1000, Date.now, 2);

    expect(registry.claimAutomaticRetry("one.myshopify.com")).toBe("claimed");
    expect(registry.claimAutomaticRetry("two.myshopify.com")).toBe("claimed");
    expect(registry.claimAutomaticRetry("three.myshopify.com")).toBe(
      "capacity_exhausted"
    );
    expect(registry.claimAutomaticRetry("one.myshopify.com")).toBe(
      "already_claimed"
    );
  });

  it("prunes expired entries before enforcing capacity", () => {
    let now = 1_000;
    const registry = new OAuthRecoveryRegistry(100, () => now, 1);

    expect(registry.claimAutomaticRetry("one.myshopify.com")).toBe("claimed");
    expect(registry.claimAutomaticRetry("two.myshopify.com")).toBe(
      "capacity_exhausted"
    );

    now += 100;
    expect(registry.claimAutomaticRetry("two.myshopify.com")).toBe("claimed");
  });
});
