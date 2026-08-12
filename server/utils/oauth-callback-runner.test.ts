import {
  CookieNotFound,
  InvalidOAuthError,
  type Session,
} from "@shopify/shopify-api";
import { describe, expect, it, vi } from "vitest";
import { OAuthRecoveryRegistry } from "./oauth-recovery";
import { runOAuthCallback } from "./oauth-callback-runner";

function responseDouble() {
  const response = {
    headersSent: false,
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

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });
const sanitizeShop = vi.fn((shop: string) =>
  shop.endsWith(".myshopify.com") ? shop.toLowerCase() : null
);

function dependencies(
  registry: OAuthRecoveryRegistry,
  response: ReturnType<typeof responseDouble>
) {
  return {
    shop: "slow-shop.myshopify.com",
    response: response as any,
    registry,
    logger: logger(),
    sanitizeShop,
  };
}

function callbackFor(shop: string) {
  return {
    session: { shop } as Session,
    headers: {} as Headers,
  };
}

describe("runOAuthCallback", () => {
  it("turns the first CookieNotFound into one fresh OAuth restart", async () => {
    const registry = new OAuthRecoveryRegistry();
    const response = responseDouble();

    const result = await runOAuthCallback({
      ...dependencies(registry, response),
      execute: vi.fn().mockRejectedValue(new CookieNotFound("missing")),
    });

    expect(result).toBeUndefined();
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "/api/auth?shop=slow-shop.myshopify.com"
    );
  });

  it("turns the second CookieNotFound into a 409 without another redirect", async () => {
    const registry = new OAuthRecoveryRegistry();
    registry.claimAutomaticRetry("slow-shop.myshopify.com");
    const response = responseDouble();

    const result = await runOAuthCallback({
      ...dependencies(registry, response),
      execute: vi.fn().mockRejectedValue(new CookieNotFound("missing")),
    });

    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("recovers the observed slow-install sequence through a fresh SDK callback", async () => {
    const registry = new OAuthRecoveryRegistry();
    const firstResponse = responseDouble();

    await expect(
      runOAuthCallback({
        ...dependencies(registry, firstResponse),
        execute: vi.fn().mockRejectedValue(new CookieNotFound("missing")),
      })
    ).resolves.toBeUndefined();
    expect(firstResponse.redirect).toHaveBeenCalledTimes(1);
    expect(firstResponse.redirect).toHaveBeenCalledWith(
      303,
      "/api/auth?shop=slow-shop.myshopify.com"
    );

    const freshResponse = responseDouble();
    const callback = callbackFor("slow-shop.myshopify.com");
    await expect(
      runOAuthCallback({
        ...dependencies(registry, freshResponse),
        execute: vi.fn().mockResolvedValue(callback),
      })
    ).resolves.toBe(callback);

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
  });

  it("rethrows generic OAuth errors for the existing failure path", async () => {
    const registry = new OAuthRecoveryRegistry();
    const response = responseDouble();
    const error = new InvalidOAuthError("bad hmac");

    await expect(
      runOAuthCallback({
        ...dependencies(registry, response),
        execute: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toBe(error);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("returns the full successful callback and clears prior recovery state", async () => {
    const registry = new OAuthRecoveryRegistry();
    registry.claimAutomaticRetry("slow-shop.myshopify.com");
    const response = responseDouble();
    const callback = callbackFor("slow-shop.myshopify.com");
    const logs = logger();

    await expect(
      runOAuthCallback({
        ...dependencies(registry, response),
        logger: logs,
        execute: vi.fn().mockResolvedValue(callback),
      })
    ).resolves.toBe(callback);

    expect(registry.claimAutomaticRetry("slow-shop.myshopify.com")).toBe(true);
    expect(logs.info).toHaveBeenCalledWith(
      "[AuthCallback] oauth_cookie_recovered",
      {
        shop: "slow-shop.myshopify.com",
        action: "oauth_completed",
      }
    );
  });

  it("does not log recovery success for an ordinary callback", async () => {
    const registry = new OAuthRecoveryRegistry();
    const response = responseDouble();
    const logs = logger();

    await runOAuthCallback({
      ...dependencies(registry, response),
      logger: logs,
      execute: vi.fn().mockResolvedValue(callbackFor("slow-shop.myshopify.com")),
    });

    expect(logs.info).not.toHaveBeenCalled();
  });

  it("does not attempt recovery after response headers were sent", async () => {
    const registry = new OAuthRecoveryRegistry();
    const response = responseDouble();
    response.headersSent = true;
    const error = new CookieNotFound("missing");

    await expect(
      runOAuthCallback({
        ...dependencies(registry, response),
        execute: vi.fn().mockRejectedValue(error),
      })
    ).rejects.toBe(error);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });
});
