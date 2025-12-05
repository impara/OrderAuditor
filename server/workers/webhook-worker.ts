
import { queueService, QUEUES } from "../services/queue.service";
import { webhookProcessor } from "../services/webhook-processor.service";
import { logger } from "../utils/logger";

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
      logger.info("[Worker] Starting webhook worker...");

      // Register handler for orders/create
      await queueService.process(
        QUEUES.ORDERS_CREATE,
        async (job) => {
          const { data } = job;
          await webhookProcessor.processOrderCreate(data);
        },
        {
          teamSize: 5, // Process up to 5 jobs concurrently
          teamConcurrency: 5,
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
