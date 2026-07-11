import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getHistoricalScanRun: vi.fn(),
    getHistoricalScanRunById: vi.fn(),
    createHistoricalScanRun: vi.fn(),
    updateHistoricalScanRun: vi.fn(),
    retryHistoricalScanRun: vi.fn(),
    getFlaggedOrdersForScan: vi.fn(),
    getStaleHistoricalScanRuns: vi.fn(),
  },
  queueService: { addJob: vi.fn(), isJobViable: vi.fn() },
  shopifyService: { listOrdersCreatedSince: vi.fn() },
  processOrder: vi.fn(),
  getOfflineAccessToken: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("./queue.service", () => ({
  queueService: mocks.queueService,
  QUEUES: { HISTORICAL_SCAN: "historical-scan-processing" },
}));
vi.mock("./shopify.service", () => ({ shopifyService: mocks.shopifyService }));
vi.mock("./order-processing.service", () => ({ processOrder: mocks.processOrder }));
vi.mock("../shopify-auth", () => ({
  getOfflineAccessToken: mocks.getOfflineAccessToken,
}));
vi.mock("../utils/logger", () => ({ logger: mocks.logger }));

import {
  countConnectedDuplicateGroups,
  HistoricalScanService,
} from "./historical-scan.service";

const run = {
  id: "run-1",
  shopDomain: "test.myshopify.com",
  status: "queued",
  requestedAt: new Date("2026-07-01T12:00:00.000Z"),
  statusUpdatedAt: new Date("2026-07-01T12:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  windowDays: 60,
  attemptCount: 1,
  ordersFetched: 0,
  ordersImported: 0,
  matchesFound: 0,
  candidateCapExceeded: false,
  queueJobId: null,
  errorMessage: null,
} as const;

describe("HistoricalScanService", () => {
  let service: HistoricalScanService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HistoricalScanService();
    mocks.storage.getHistoricalScanRunById.mockResolvedValue(run);
    mocks.storage.updateHistoricalScanRun.mockImplementation(
      async (_id, updates) => ({ ...run, ...updates })
    );
    mocks.storage.getFlaggedOrdersForScan.mockResolvedValue([]);
    mocks.getOfflineAccessToken.mockResolvedValue("token");
    mocks.processOrder.mockResolvedValue({
      order: { id: "stored" },
      match: null,
      candidateCapExceeded: false,
    });
    mocks.queueService.addJob.mockResolvedValue("job-1");
  });

  it("processes fetched orders chronologically with historical provenance", async () => {
    mocks.shopifyService.listOrdersCreatedSince.mockResolvedValue([
      { id: 2, created_at: "2026-06-02T00:00:00.000Z" },
      { id: 1, created_at: "2026-06-01T00:00:00.000Z" },
    ]);
    mocks.storage.getFlaggedOrdersForScan.mockResolvedValue([
      { id: "b", duplicateOfOrderId: "a" },
      { id: "c", duplicateOfOrderId: "b" },
    ]);

    await service.executeRun(run.id);

    expect(mocks.processOrder.mock.calls.map((call) => call[0].shopifyOrderId)).toEqual([
      "1",
      "2",
    ]);
    expect(mocks.processOrder).toHaveBeenCalledWith(
      expect.anything(),
      "token",
      { mode: "historical", scanRunId: run.id }
    );
    expect(mocks.storage.updateHistoricalScanRun).toHaveBeenLastCalledWith(
      run.id,
      expect.objectContaining({
        status: "completed",
        ordersFetched: 2,
        ordersImported: 2,
        matchesFound: 1,
      })
    );
  });

  it("marks a failed fetch safely", async () => {
    mocks.shopifyService.listOrdersCreatedSince.mockRejectedValue(
      new Error("raw Shopify response")
    );

    await expect(service.executeRun(run.id)).rejects.toThrow();
    expect(mocks.storage.updateHistoricalScanRun).toHaveBeenLastCalledWith(
      run.id,
      expect.objectContaining({
        status: "failed",
        errorMessage: "We could not complete the recent-order scan.",
      })
    );
  });

  it("retries the same failed row and preserves its identity", async () => {
    const failedRun = { ...run, status: "failed" as const };
    const retriedRun = {
      ...failedRun,
      status: "queued" as const,
      attemptCount: 2,
    };
    mocks.storage.getHistoricalScanRun.mockResolvedValue(failedRun);
    mocks.storage.retryHistoricalScanRun.mockResolvedValue(retriedRun);

    const result = await service.startOrRetry(run.shopDomain);

    expect(mocks.storage.retryHistoricalScanRun).toHaveBeenCalledWith(run.id);
    expect(mocks.storage.createHistoricalScanRun).not.toHaveBeenCalled();
    expect(result.id).toBe(run.id);
  });

  it("reconciles a stale run only when its pg-boss job is no longer viable", async () => {
    mocks.storage.getStaleHistoricalScanRuns.mockResolvedValue([
      { ...run, status: "running", queueJobId: "job-1" },
    ]);
    mocks.queueService.isJobViable.mockResolvedValue(false);

    await expect(service.reconcileStaleRuns(new Date("2026-07-02"))).resolves.toBe(1);
    expect(mocks.storage.updateHistoricalScanRun).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ status: "failed" })
    );
  });
});

describe("countConnectedDuplicateGroups", () => {
  it("counts a C -> B -> A chain as one group", () => {
    expect(
      countConnectedDuplicateGroups([
        { id: "b", duplicateOfOrderId: "a" },
        { id: "c", duplicateOfOrderId: "b" },
      ] as any)
    ).toBe(1);
  });
});
