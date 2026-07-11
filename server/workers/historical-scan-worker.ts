import { historicalScanService } from "../services/historical-scan.service";
import { queueService, QUEUES } from "../services/queue.service";
import { logger } from "../utils/logger";

const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000;

export class HistoricalScanWorker {
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    await historicalScanService.reconcileStaleRuns();
    await queueService.process(
      QUEUES.HISTORICAL_SCAN,
      async (job) => {
        await historicalScanService.executeRun(job.data.runId);
      },
      { teamSize: 1, teamConcurrency: 1, includeMetadata: true }
    );

    if (!this.reconciliationTimer) {
      this.reconciliationTimer = setInterval(() => {
        historicalScanService.reconcileStaleRuns().catch((error) => {
          logger.error("[HistoricalScanWorker] Reconciliation failed:", error);
        });
      }, RECONCILIATION_INTERVAL_MS);
      this.reconciliationTimer.unref?.();
    }
    logger.info("[HistoricalScanWorker] Started");
  }
}

export const historicalScanWorker = new HistoricalScanWorker();
