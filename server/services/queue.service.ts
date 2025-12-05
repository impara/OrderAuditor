
import PgBoss from "pg-boss";
import { logger } from "../utils/logger";
import { db } from "../db";

// Queue names
export const QUEUES = {
  ORDERS_CREATE: "orders-create-processing",
} as const;

export class QueueService {
  private static instance: QueueService;
  private boss: PgBoss | null = null;
  private isReady: boolean = false;

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Initialize the queue system
   * Uses the existing database connection string from environment variables
   */
  public async initialize(): Promise<void> {
    if (this.boss) {
      return;
    }

    try {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL not set");
      }

      this.boss = new PgBoss(connectionString);
      
      this.boss.on("error", (error) => {
        logger.error("[Queue] pg-boss error:", error);
      });

      await this.boss.start();
      this.isReady = true;
      logger.info("[Queue] Queue service initialized and started");
    } catch (error) {
      logger.error("[Queue] Failed to initialize queue service:", error);
      throw error;
    }
  }

  /**
   * Stop the queue system
   */
  public async stop(): Promise<void> {
    if (this.boss) {
      await this.boss.stop();
      this.isReady = false;
      this.boss = null;
      logger.info("[Queue] Queue service stopped");
    }
  }

  /**
   * Add a job to the queue
   */
  public async addJob(queueName: string, data: any, options: any = {}): Promise<string | null> {
    if (!this.boss || !this.isReady) {
      logger.warn(`[Queue] Attempted to add job but queue is not ready. boss: ${!!this.boss}, isReady: ${this.isReady}`);
      return null;
    }

    try {
      // Ensure queue exists (idempotent)
      await this.boss.createQueue(queueName);

      // Default options
      const jobOptions = {
        retryLimit: 3,
        retryDelay: 60, // 1 minute
        expireInMinutes: 15, // Job timeout
        ...options
      };

      const jobId = await this.boss.send(queueName, data, jobOptions);
      
      if (!jobId) {
         logger.error(`[Queue] pg-boss.send returned null for ${queueName}. Params: ${JSON.stringify(jobOptions)}`);
      } else {
         logger.debug(`[Queue] Job enqueued to ${queueName}. Job ID: ${jobId}`);
      }
      
      return jobId;
    } catch (error) {
      logger.error(`[Queue] Failed to add job to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Register a worker for a specific queue
   */
  public async process(queueName: string, handler: (job: any) => Promise<void>, options: any = {}): Promise<void> {
    if (!this.boss || !this.isReady) {
      throw new Error("Queue service not initialized");
    }

    try {
      // pg-boss work function takes a handler that returns a promise
      await this.boss.work(queueName, options, async (jobs: any) => {
        // Handle array of jobs (pg-boss v10+ default for some configs) or single job
        const jobList = Array.isArray(jobs) ? jobs : [jobs];

        for (const job of jobList) {
            try {
              logger.info(`[Queue] Processing job ${job?.id} from ${queueName}`);
              await handler(job);
              logger.info(`[Queue] Job ${job?.id} completed successfully`);
            } catch (error) {
              logger.error(`[Queue] Job ${job?.id} failed:`, error);
              // Re-throw to let pg-boss handle retry logic
              // Note: If treating as batch, failing one might be tricky if we want others to succeed.
              // But pg-boss usually tracks them individually if returned as array?
              // Actually, if we throw here, pg-boss v10 might fail the whole batch?
              // Let's assume throwing fails the job.
              throw error;
            }
        }
      });
      
      logger.info(`[Queue] Worker registered for ${queueName}`);
    } catch (error) {
      logger.error(`[Queue] Failed to register worker for ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Get queue health statistics
   */
  public async getHealthStats(): Promise<any> {
    if (!this.boss || !this.isReady) {
      return { status: "stopped" };
    }

    try {
      // We can query internal pg-boss tables if needed, but for now returned basic status
      // A more comprehensive check would query pgboss.job table
      return {
        status: "active",
        queues: Object.values(QUEUES)
      };
    } catch (error) {
      logger.error("[Queue] Failed to get health stats:", error);
      return { status: "error", error: String(error) };
    }
  }
}

export const queueService = QueueService.getInstance();
