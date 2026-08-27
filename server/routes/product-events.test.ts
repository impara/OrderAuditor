import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { createProductEventHandler } from "./product-events";

const validBody = {
  eventName: "dashboard_opened",
  eventKey: "0123456789abcdef0123456789abcdef",
  properties: {},
};

function createResponse(shop = "verified-shop.myshopify.com") {
  const res = {
    locals: { shopify: { shop } },
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("createProductEventHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 201 and scopes a first event to the verified shop", async () => {
    const recordProductEvent = vi.fn().mockResolvedValue({ id: "event-id" });
    const handler = createProductEventHandler({ recordProductEvent });
    const req = { body: validBody } as Request;
    const res = createResponse();

    await handler(req, res);

    expect(recordProductEvent).toHaveBeenCalledWith(
      "verified-shop.myshopify.com",
      validBody
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ recorded: true });
  });

  it("returns 200 for an idempotent duplicate", async () => {
    const recordProductEvent = vi.fn().mockResolvedValue(undefined);
    const handler = createProductEventHandler({ recordProductEvent });
    const res = createResponse();

    await handler({ body: validBody } as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ recorded: false });
  });

  it.each([
    { ...validBody, eventName: "unknown_event" },
    { ...validBody, eventKey: "merchant@example.com" },
    { ...validBody, properties: { orderId: "order-1" } },
  ])("rejects invalid or identifying payload %#", async (body) => {
    const recordProductEvent = vi.fn();
    const handler = createProductEventHandler({ recordProductEvent });
    const res = createResponse();

    await handler({ body } as Request, res);

    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid product event" });
  });

  it("ignores a body shop and uses only the verified Shopify shop", async () => {
    const recordProductEvent = vi.fn().mockResolvedValue({ id: "event-id" });
    const handler = createProductEventHandler({ recordProductEvent });
    const res = createResponse("trusted.myshopify.com");

    await handler(
      {
        body: { ...validBody, shop: "attacker.myshopify.com" },
      } as Request,
      res
    );

    expect(recordProductEvent).toHaveBeenCalledWith(
      "trusted.myshopify.com",
      validBody
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects an event when no verified Shopify shop is present", async () => {
    const recordProductEvent = vi.fn();
    const handler = createProductEventHandler({ recordProductEvent });
    const res = createResponse();
    res.locals = { shopify: {} };

    await handler({ body: validBody } as Request, res);

    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Verified shop is required",
    });
  });

  it("returns 500 when storage fails", async () => {
    const recordProductEvent = vi.fn().mockRejectedValue(new Error("db failed"));
    const handler = createProductEventHandler({ recordProductEvent });
    const res = createResponse();

    await handler({ body: validBody } as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to record product event",
    });
  });
});
