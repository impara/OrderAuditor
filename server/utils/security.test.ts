import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  buildFrameAncestorsCsp,
  isAllowedSlackWebhookUrl,
  requireInternalAdmin,
  sessionTokenVerificationError,
  validateReturnUrl,
} from "./security";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("validateReturnUrl", () => {
  const appUrl = "https://duplicate.example.com";

  it("resolves a relative path to the configured app origin", () => {
    expect(validateReturnUrl("/subscription?ok=1", appUrl)).toBe(
      "https://duplicate.example.com/subscription?ok=1"
    );
  });

  it("accepts an absolute URL only on the exact origin", () => {
    expect(validateReturnUrl("https://duplicate.example.com/done", appUrl)).toBe(
      "https://duplicate.example.com/done"
    );
  });

  it.each([
    "//evil.example/phish",
    "https://evil.example/phish",
    "https://duplicate.example.com:8443/phish",
    "javascript:alert(1)",
  ])("rejects off-origin or unsafe return URL %s", (value) => {
    expect(validateReturnUrl(value, appUrl)).toBe(
      "https://duplicate.example.com/subscription?upgrade=success"
    );
  });
});

describe("isAllowedSlackWebhookUrl", () => {
  it("accepts a canonical Slack incoming webhook", () => {
    expect(
      isAllowedSlackWebhookUrl(
        `https://hooks.slack.com/services/${[
          "T00000000",
          "B00000000",
          "synthetic-fixture-not-a-secret",
        ].join("/")}`
      )
    ).toBe(true);
  });

  it.each([
    "http://hooks.slack.com/services/T/B/X",
    "https://hooks.slack.com.evil.example/services/T/B/X",
    "https://hooks.slack.com:8443/services/T/B/X",
    "https://hooks.slack.com@127.0.0.1/services/T/B/X",
    "https://127.0.0.1/internal",
    "https://hooks.slack.com/services/T/B/X?next=http://127.0.0.1",
  ])("rejects unsafe webhook destination %s", (value) => {
    expect(isAllowedSlackWebhookUrl(value)).toBe(false);
  });
});

describe("buildFrameAncestorsCsp", () => {
  it("includes a sanitized shop and Shopify Admin", () => {
    expect(buildFrameAncestorsCsp("Demo-Shop.myshopify.com")).toBe(
      "frame-ancestors https://demo-shop.myshopify.com https://admin.shopify.com;"
    );
  });

  it("does not reflect an invalid shop into the header", () => {
    expect(buildFrameAncestorsCsp("evil.example; frame-src *")).toBe(
      "frame-ancestors https://admin.shopify.com;"
    );
  });
});

describe("sessionTokenVerificationError", () => {
  it("uses a stable message with no credential material", () => {
    expect(sessionTokenVerificationError().message).toBe(
      "Failed to parse session token"
    );
  });
});

describe("requireInternalAdmin", () => {
  function responseMock() {
    const res = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res);
    return res;
  }

  function requestMock(header?: string, queryToken?: string) {
    return {
      get: vi.fn((name: string) =>
        name === "X-Admin-Token" ? header : undefined
      ),
      query: queryToken ? { token: queryToken } : {},
    } as unknown as Request;
  }

  it("accepts the configured header token", () => {
    process.env.NODE_ENV = "production";
    process.env.INTERNAL_ADMIN_TOKEN = "expected-token";
    const next = vi.fn() as NextFunction;
    requireInternalAdmin(requestMock("expected-token"), responseMock(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a correct token supplied only in the query string", () => {
    process.env.NODE_ENV = "production";
    process.env.INTERNAL_ADMIN_TOKEN = "expected-token";
    const res = responseMock();
    const next = vi.fn() as NextFunction;
    requireInternalAdmin(requestMock(undefined, "expected-token"), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed when production has no configured token", () => {
    process.env.NODE_ENV = "production";
    delete process.env.INTERNAL_ADMIN_TOKEN;
    delete process.env.ADMIN_API_TOKEN;
    const res = responseMock();
    requireInternalAdmin(requestMock(), res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
