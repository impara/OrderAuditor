/**
 * Regression tests for getDashboardStats in storage.ts
 *
 * Guards against:
 * - averageResolutionTime being hardcoded (was 2.5 forever before fix)
 * - Zero division / null-safe behaviour when no resolved orders exist
 * - potentialDuplicateValue summing correctly
 *
 * Strategy: we mock `db` at the module level so we never touch a real
 * database, keeping the tests fast and environment-agnostic.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock db BEFORE any import that touches storage.ts (which imports db.ts)
// ---------------------------------------------------------------------------
const mockSelect = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  db: {
    select: mockSelect,
  },
}));

// Import AFTER mock is set up
import { DatabaseStorage, FREE_TIER_ORDER_LIMIT } from "./storage";

// ---------------------------------------------------------------------------
// Helper: build a chainable query builder stub that resolves to `rows`
// ---------------------------------------------------------------------------
function buildQueryStub(rows: any[]) {
  const stub: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // When awaited, return the rows array
    then: (resolve: (v: any) => void) => Promise.resolve(rows).then(resolve),
  };
  return stub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DatabaseStorage.getDashboardStats — averageResolutionTime regression", () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  it("returns averageResolutionTime = 0 when there are no resolved orders", async () => {
    // All five queries: totalFlagged, lastWeekFlagged, totalValue, todayFlagged, avgResolution
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))   // totalFlagged
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))   // lastWeekFlagged
      .mockReturnValueOnce(buildQueryStub([{ sum: 0 }]))     // totalValue
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))   // todayFlagged
      .mockReturnValueOnce(buildQueryStub([{ avgHours: 0 }])); // avgResolution

    const stats = await storage.getDashboardStats("shop.myshopify.com");

    expect(stats.averageResolutionTime).toBe(0);
  });

  it("returns the real average when resolved orders exist", async () => {
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{ count: 5 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 3 }]))
      .mockReturnValueOnce(buildQueryStub([{ sum: 500 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 1 }]))
      .mockReturnValueOnce(buildQueryStub([{ avgHours: 4.75 }]));

    const stats = await storage.getDashboardStats("shop.myshopify.com");

    expect(stats.averageResolutionTime).toBe(4.8); // rounded to 1 decimal
  });

  it("does NOT return the hardcoded 2.5 placeholder", async () => {
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{ count: 10 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 5 }]))
      .mockReturnValueOnce(buildQueryStub([{ sum: 1000 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 2 }]))
      .mockReturnValueOnce(buildQueryStub([{ avgHours: 6.0 }]));

    const stats = await storage.getDashboardStats("shop.myshopify.com");

    // 2.5 was the hardcoded placeholder — this must no longer come from nowhere
    expect(stats.averageResolutionTime).not.toBe(2.5);
    expect(stats.averageResolutionTime).toBe(6.0);
  });

  it("returns totalFlagged, ordersFlaggedToday, and potentialDuplicateValue correctly", async () => {
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{ count: 12 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 4 }]))
      .mockReturnValueOnce(buildQueryStub([{ sum: 1234.56 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 3 }]))
      .mockReturnValueOnce(buildQueryStub([{ avgHours: 1.5 }]));

    const stats = await storage.getDashboardStats("shop.myshopify.com");

    expect(stats.totalFlagged).toBe(12);
    expect(stats.ordersFlaggedToday).toBe(3);
    expect(stats.potentialDuplicateValue).toBeCloseTo(1234.56, 2);
    expect(stats.averageResolutionTime).toBe(1.5);
  });

  it("handles null/undefined avgHours gracefully (coalesces to 0)", async () => {
    mockSelect
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))
      .mockReturnValueOnce(buildQueryStub([{ sum: null }]))
      .mockReturnValueOnce(buildQueryStub([{ count: 0 }]))
      .mockReturnValueOnce(buildQueryStub([{ avgHours: null }]));

    const stats = await storage.getDashboardStats("shop.myshopify.com");

    expect(stats.averageResolutionTime).toBe(0);
    expect(stats.potentialDuplicateValue).toBe(0);
  });
});

describe("FREE_TIER_ORDER_LIMIT constant", () => {
  it("is exported from storage as 50", () => {
    expect(FREE_TIER_ORDER_LIMIT).toBe(50);
  });
});
