import { CookieNotFound, InvalidOAuthError } from "@shopify/shopify-api";
import { describe, expect, it, vi } from "vitest";
import {
  buildOAuthRestartPath,
  handleOAuthCallbackFailure,
  isOAuthCookieNotFound,
  renderOAuthRecoveryPage,
} from "./oauth-callback-recovery";
import { OAuthRecoveryRegistry } from "./oauth-recovery";

function responseDouble() {
  const response = {
    set: vi.fn(),
    type: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };
  response.set.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.redirect.mockReturnValue(response);
  response.status.mockReturnValue(response);
  response.send.mockReturnValue(response);
  return response;
}

const logger = () => ({ warn: vi.fn(), error: vi.fn() });
const sanitizeShop = vi.fn((shop: string) =>
  /^[a-z0-9][a-z0-9_-]*\.myshopify\.com$/i.test(shop)
    ? shop.toLowerCase()
    : null
);

describe("OAuth callback recovery helpers", () => {
  it("detects only Shopify CookieNotFound errors", () => {
    expect(isOAuthCookieNotFound(new CookieNotFound("missing"))).toBe(true);
    expect(isOAuthCookieNotFound(new InvalidOAuthError("bad hmac"))).toBe(false);
    expect(isOAuthCookieNotFound(new Error("Could not find OAuth cookie"))).toBe(false);
    expect(isOAuthCookieNotFound("Could not find OAuth cookie")).toBe(false);
  });

  it("builds only relative restart paths for standard Shopify shop domains", () => {
    expect(buildOAuthRestartPath("store-name.myshopify.com")).toBe(
      "/api/auth?shop=store-name.myshopify.com"
    );
    expect(buildOAuthRestartPath("store_name.myshopify.com")).toBe(
      "/api/auth?shop=store_name.myshopify.com"
    );
    expect(() => buildOAuthRestartPath("evil.example")).toThrow();
    expect(() =>
      buildOAuthRestartPath("store.myshopify.com%0d%0aLocation:evil")
    ).toThrow();
    expect(() => buildOAuthRestartPath("store.myshopify.com/redirect")).toThrow();
  });

  it("renders a safe manual recovery page", () => {
    const html = renderOAuthRecoveryPage("store-name.myshopify.com");

    expect(html).toContain("Reconnect Duplicate Guard");
    expect(html).toContain("/api/auth?shop=store-name.myshopify.com");
    expect(html).not.toMatch(/code=|hmac=|state=|timestamp=/i);
    expect(html).not.toContain("<script");
  });
});

describe("handleOAuthCallbackFailure", () => {
  it("discards the stale callback and redirects once using only its sanitized shop", () => {
    const registry = new OAuthRecoveryRegistry();
    const response = responseDouble();
    const logs = logger();

    expect(
      handleOAuthCallbackFailure({
        error: new CookieNotFound(
          "missing code=secret-code&hmac=secret-hmac&state=secret-state"
        ),
        shop: "SLOW-SHOP.MYSHOPIFY.COM",
        response: response as any,
        registry,
        logger: logs,
        sanitizeShop,
      })
    ).toBe(true);

    expect(response.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "/api/auth?shop=slow-shop.myshopify.com"
    );
    const emitted = JSON.stringify([
      response.redirect.mock.calls,
      logs.warn.mock.calls,
      logs.error.mock.calls,
    ]);
    expect(emitted).not.toMatch(/secret-code|secret-hmac|secret-state/);
    expect(logs.warn).toHaveBeenCalledWith(
      "[AuthCallback] oauth_cookie_missing",
      { shop: "slow-shop.myshopify.com", action: "automatic_retry" }
    );
  });

  it("stops a retry loop with a safe 409 page containing a manual restart link", () => {
    const registry = new OAuthRecoveryRegistry();
    registry.claimAutomaticRetry("slow-shop.myshopify.com");
    const response = responseDouble();
    const logs = logger();

    expect(
      handleOAuthCallbackFailure({
        error: new CookieNotFound("missing"),
        shop: "slow-shop.myshopify.com",
        response: response as any,
        registry,
        logger: logs,
        sanitizeShop,
      })
    ).toBe(true);

    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.type).toHaveBeenCalledWith("html");
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth?shop=slow-shop.myshopify.com")
    );
    expect(logs.error).toHaveBeenCalledWith(
      "[AuthCallback] oauth_cookie_missing",
      { shop: "slow-shop.myshopify.com", action: "manual_recovery" }
    );
  });

  it("rejects missing, array-valued, malformed, and invalid shops", () => {
    for (const shop of [
      undefined,
      null,
      ["one.myshopify.com", "two.myshopify.com"],
      "evil.example",
      "store.myshopify.com/redirect",
    ]) {
      const response = responseDouble();
      expect(
        handleOAuthCallbackFailure({
          error: new CookieNotFound("missing"),
          shop,
          response: response as any,
          registry: new OAuthRecoveryRegistry(),
          logger: logger(),
          sanitizeShop,
        })
      ).toBe(true);
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.redirect).not.toHaveBeenCalled();
    }
  });

  it("leaves non-cookie OAuth errors untouched", () => {
    const response = responseDouble();
    expect(
      handleOAuthCallbackFailure({
        error: new InvalidOAuthError("bad hmac"),
        shop: "slow-shop.myshopify.com",
        response: response as any,
        registry: new OAuthRecoveryRegistry(),
        logger: logger(),
        sanitizeShop,
      })
    ).toBe(false);
    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });
});
