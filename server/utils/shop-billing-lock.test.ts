import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { connect: mocks.connect },
}));

import { withShopBillingLock } from "./shop-billing-lock";

describe("withShopBillingLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
  });

  it("acquires and releases the same shop lock around the operation", async () => {
    const operation = vi.fn().mockResolvedValue("done");

    await expect(
      withShopBillingLock("Test-Shop.myshopify.com", operation)
    ).resolves.toBe("done");

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("pg_advisory_lock"),
      ["duplicate-guard-billing", "test-shop.myshopify.com"]
    );
    expect(operation).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("pg_advisory_unlock"),
      ["duplicate-guard-billing", "test-shop.myshopify.com"]
    );
    expect(mocks.release).toHaveBeenCalledWith(false);
  });

  it("releases the lock when the operation throws", async () => {
    await expect(
      withShopBillingLock("test.myshopify.com", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledWith(false);
  });

  it("discards the client if unlock fails", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("unlock failed"));

    await expect(
      withShopBillingLock("test.myshopify.com", async () => "done")
    ).resolves.toBe("done");

    expect(mocks.release).toHaveBeenCalledWith(true);
  });

  it("rejects invalid shops before acquiring a connection", async () => {
    await expect(
      withShopBillingLock("https://evil.example", async () => "no")
    ).rejects.toThrow("Invalid Shopify shop domain");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
