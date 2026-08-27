import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  db: {
    insert: mockInsert,
    delete: mockDelete,
  },
}));

import { DatabaseStorage } from "./storage";
import { productEvents } from "@shared/schema";

describe("DatabaseStorage product events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a shop-scoped event and treats a duplicate event key as idempotent", async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "event-id",
          shopDomain: "shop.myshopify.com",
          eventName: "dashboard_opened",
          eventKey: "0123456789abcdef0123456789abcdef",
          properties: {},
          occurredAt: new Date("2026-08-27T10:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    mockInsert.mockReturnValue({ values });

    const storage = new DatabaseStorage();
    const payload = {
      eventName: "dashboard_opened" as const,
      eventKey: "0123456789abcdef0123456789abcdef",
      properties: {},
    };

    const first = await storage.recordProductEvent("shop.myshopify.com", payload);
    const duplicate = await storage.recordProductEvent(
      "shop.myshopify.com",
      payload
    );

    expect(first?.id).toBe("event-id");
    expect(duplicate).toBeUndefined();
    expect(mockInsert).toHaveBeenCalledWith(productEvents);
    expect(values).toHaveBeenNthCalledWith(1, {
      shopDomain: "shop.myshopify.com",
      eventName: "dashboard_opened",
      eventKey: "0123456789abcdef0123456789abcdef",
      properties: {},
    });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it("deletes product events during shop uninstall cleanup", async () => {
    const deletedTables: unknown[] = [];
    mockDelete.mockImplementation((table) => {
      deletedTables.push(table);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    });

    const storage = new DatabaseStorage();
    await storage.deleteShopData("shop.myshopify.com");

    expect(deletedTables[0]).toBe(productEvents);
    expect(deletedTables).toContain(productEvents);
  });
});
