import type { HistoricalScanRun, Order } from "@shared/schema";
import { getOfflineAccessToken } from "../shopify-auth";
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { mapShopifyOrder } from "./order-mapper.service";
import { processOrder } from "./order-processing.service";
import { queueService, QUEUES } from "./queue.service";
import { shopifyService } from "./shopify.service";

const WINDOW_DAYS = 60;
const JOB_EXPIRE_MINUTES = 120;
const JOB_RETRY_LIMIT = 3;
const JOB_RETRY_DELAY_SECONDS = 60;
const STALE_BUDGET_MS =
  (JOB_EXPIRE_MINUTES * (JOB_RETRY_LIMIT + 1) * 60 +
    JOB_RETRY_DELAY_SECONDS * JOB_RETRY_LIMIT) *
  1000;

export class HistoricalScanConflictError extends Error {
  constructor(public readonly run: HistoricalScanRun) {
    super(`Historical scan is ${run.status}`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("duplicate key") || message.includes("unique constraint");
}

function countConnectedDuplicateGroups(flaggedOrders: Order[]): number {
  const parent: Record<string, string> = {};
  const find = (id: string): string => {
    parent[id] ||= id;
    if (parent[id] !== id) parent[id] = find(parent[id]);
    return parent[id];
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (const order of flaggedOrders) {
    if (order.duplicateOfOrderId) {
      union(order.id, order.duplicateOfOrderId);
    }
  }
  const roots: Record<string, true> = {};
  for (const order of flaggedOrders) {
    if (order.duplicateOfOrderId) {
      roots[find(order.id)] = true;
    }
  }
  return Object.keys(roots).length;
}

export class HistoricalScanService {
  async getLatest(shopDomain: string): Promise<HistoricalScanRun | undefined> {
    return storage.getHistoricalScanRun(shopDomain);
  }

  private async enqueue(run: HistoricalScanRun): Promise<HistoricalScanRun> {
    try {
      const jobId = await queueService.addJob(
        QUEUES.HISTORICAL_SCAN,
        { runId: run.id },
        {
          expireInMinutes: JOB_EXPIRE_MINUTES,
          retryLimit: JOB_RETRY_LIMIT,
          retryDelay: JOB_RETRY_DELAY_SECONDS,
          singletonKey: run.shopDomain,
        }
      );
      if (!jobId) {
        throw new Error("Historical scan job was not enqueued");
      }
      return storage.updateHistoricalScanRun(run.id, { queueJobId: jobId });
    } catch (error) {
      await storage.updateHistoricalScanRun(run.id, {
        status: "failed",
        statusUpdatedAt: new Date(),
        completedAt: new Date(),
        errorMessage: "The scan could not be queued. Please retry.",
      });
      throw error;
    }
  }

  async startOrRetry(shopDomain: string): Promise<HistoricalScanRun> {
    let run = await storage.getHistoricalScanRun(shopDomain);
    if (!run) {
      try {
        run = await storage.createHistoricalScanRun({
          shopDomain,
          status: "queued",
          requestedAt: new Date(),
          windowDays: WINDOW_DAYS,
          attemptCount: 1,
          ordersFetched: 0,
          ordersImported: 0,
          matchesFound: 0,
          candidateCapExceeded: false,
          queueJobId: null,
          errorMessage: null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const concurrentRun = await storage.getHistoricalScanRun(shopDomain);
        if (!concurrentRun) throw error;
        throw new HistoricalScanConflictError(concurrentRun);
      }
      return this.enqueue(run);
    }

    if (run.status !== "failed") {
      throw new HistoricalScanConflictError(run);
    }
    const retried = await storage.retryHistoricalScanRun(run.id);
    if (!retried) {
      const concurrentRun = await storage.getHistoricalScanRun(shopDomain);
      throw new HistoricalScanConflictError(concurrentRun || run);
    }
    return this.enqueue(retried);
  }

  async executeRun(runId: string): Promise<void> {
    const run = await storage.getHistoricalScanRunById(runId);
    if (!run || run.status === "completed") return;

    const startedAt = new Date();
    await storage.updateHistoricalScanRun(run.id, {
      status: "running",
      statusUpdatedAt: startedAt,
      startedAt: run.startedAt || startedAt,
      completedAt: null,
      errorMessage: null,
    });

    try {
      const accessToken = await getOfflineAccessToken(run.shopDomain);
      if (!accessToken) throw new Error("No offline Shopify access token available");
      const since = new Date(
        run.requestedAt.getTime() - run.windowDays * 24 * 60 * 60 * 1000
      );
      const shopifyOrders = await shopifyService.listOrdersCreatedSince(
        run.shopDomain,
        accessToken,
        since,
        run.requestedAt
      );
      shopifyOrders.sort((left, right) => {
        const timeDiff =
          new Date(left.created_at || 0).getTime() -
          new Date(right.created_at || 0).getTime();
        return timeDiff || String(left.id).localeCompare(String(right.id));
      });

      let ordersImported = 0;
      let candidateCapExceeded = run.candidateCapExceeded;
      for (const shopifyOrder of shopifyOrders) {
        const result = await processOrder(
          mapShopifyOrder(run.shopDomain, shopifyOrder),
          accessToken,
          { mode: "historical", scanRunId: run.id }
        );
        if (result.order) ordersImported += 1;
        candidateCapExceeded ||= result.candidateCapExceeded;
      }

      const flaggedOrders = await storage.getFlaggedOrdersForScan(run.id);
      await storage.updateHistoricalScanRun(run.id, {
        status: "completed",
        statusUpdatedAt: new Date(),
        completedAt: new Date(),
        ordersFetched: shopifyOrders.length,
        ordersImported,
        matchesFound: countConnectedDuplicateGroups(flaggedOrders),
        candidateCapExceeded,
        errorMessage: null,
      });
    } catch (error) {
      logger.error(`[HistoricalScan] Run ${run.id} failed:`, error);
      await storage.updateHistoricalScanRun(run.id, {
        status: "failed",
        statusUpdatedAt: new Date(),
        completedAt: new Date(),
        errorMessage: "We could not complete the recent-order scan.",
      });
      throw error;
    }
  }

  async reconcileStaleRuns(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_BUDGET_MS);
    const staleRuns = await storage.getStaleHistoricalScanRuns(cutoff);
    let reconciled = 0;
    for (const run of staleRuns) {
      if (await queueService.isJobViable(QUEUES.HISTORICAL_SCAN, run.queueJobId)) {
        continue;
      }
      await storage.updateHistoricalScanRun(run.id, {
        status: "failed",
        statusUpdatedAt: now,
        completedAt: now,
        errorMessage: "The scan worker stopped before completion. Please retry.",
      });
      reconciled += 1;
    }
    return reconciled;
  }
}

export const historicalScanService = new HistoricalScanService();
export { countConnectedDuplicateGroups };
