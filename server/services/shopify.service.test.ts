import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ShopifyService } from "./shopify.service";

describe("ShopifyService.listOrdersCreatedSince", () => {
  const fetchMock = vi.fn();
  let service: ShopifyService;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    service = new ShopifyService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps the first request to 60 days before the frozen end time", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ orders: [] }), { status: 200 })
    );
    const until = new Date("2026-07-01T12:00:00.000Z");

    await service.listOrdersCreatedSince(
      "test.myshopify.com",
      "token",
      new Date("2020-01-01T00:00:00.000Z"),
      until
    );

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("status")).toBe("any");
    expect(requestedUrl.searchParams.get("limit")).toBe("250");
    expect(requestedUrl.searchParams.get("created_at_min")).toBe(
      "2026-05-02T12:00:00.000Z"
    );
    expect(requestedUrl.searchParams.get("created_at_max")).toBe(
      until.toISOString()
    );
  });

  it("follows the next Link verbatim and removes duplicate order IDs", async () => {
    const nextUrl =
      "https://test.myshopify.com/admin/api/2025-10/orders.json?page_info=opaque&limit=250";
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [{ id: 1 }, { id: 2 }] }), {
          status: 200,
          headers: { Link: `<${nextUrl}>; rel="next"` },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orders: [{ id: 2 }, { id: 3 }] }), {
          status: 200,
        })
      );

    const orders = await service.listOrdersCreatedSince(
      "test.myshopify.com",
      "token",
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z")
    );

    expect(fetchMock.mock.calls[1][0]).toBe(nextUrl);
    expect(orders.map((order) => order.id)).toEqual([1, 2, 3]);
  });

  it("throws a safe error when Shopify rejects the request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: "Forbidden" }), {
        status: 403,
        statusText: "Forbidden",
      })
    );

    await expect(
      service.listOrdersCreatedSince(
        "test.myshopify.com",
        "token",
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-07-01T00:00:00.000Z")
      )
    ).rejects.toThrow("Shopify historical orders request failed (403 Forbidden)");
  });
});
