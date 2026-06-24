
import { queueService, QUEUES } from "../services/queue.service";
import { webhookProcessor } from "../services/webhook-processor.service";
import { logger } from "../utils/logger";

function getWorkerConcurrency(): number {
  const parsed = parseInt(process.env.WEBHOOK_WORKER_CONCURRENCY || "5", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return parsed;
}

export class WebhookWorker {
  private static instance: WebhookWorker;

  private constructor() {}

  public static getInstance(): WebhookWorker {
    if (!WebhookWorker.instance) {
      WebhookWorker.instance = new WebhookWorker();
    }
    return WebhookWorker.instance;
  }

  /**
   * Start the worker and register job handlers
   */
  public async start(): Promise<void> {
    try {
      const concurrency = getWorkerConcurrency();
      logger.info(`[Worker] Starting webhook worker (concurrency: ${concurrency})...`);

      await queueService.process(
        QUEUES.ORDERS_CREATE,
        async (job) => {
          const { data } = job;
          await webhookProcessor.processOrderCreate(data);
        },
        {
          teamSize: concurrency,
          teamConcurrency: concurrency,
        }
      );

      logger.info("[Worker] Webhook worker started successfully");
    } catch (error) {
      logger.error("[Worker] Failed to start webhook worker:", error);
      throw error;
    }
  }
}

export const webhookWorker = WebhookWorker.getInstance();
