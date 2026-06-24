
import PgBoss from "pg-boss";
import { logger } from "../utils/logger";

// Queue names
export const QUEUES = {
  ORDERS_CREATE: "orders-create-processing",
} as const;

const QUEUE_OPTIONS: Record<string, PgBoss.Queue> = {
  [QUEUES.ORDERS_CREATE]: {
    name: QUEUES.ORDERS_CREATE,
    policy: "stately",
  },
};

export class QueueService {
  private static instance: QueueService;
  private boss: PgBoss | null = null;
  private isReady: boolean = false;
  private workerRegistered: boolean = false;
  private ensuredQueues = new Set<string>();

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public getReady(): boolean {
    return this.isReady;
  }

  public isWorkerRegistered(): boolean {
    return this.workerRegistered;
  }

  public markWorkerRegistered(): void {
    this.workerRegistered = true;
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

      const maxPool = parseInt(process.env.PGBOSS_POOL_MAX || "5", 10);

      this.boss = new PgBoss({
        connectionString,
        max: maxPool,
      });
      
      this.boss.on("error", (error) => {
        logger.error("[Queue] pg-boss error:", error);
      });

      await this.boss.start();
      this.isReady = true;
      this.ensuredQueues.clear();
      logger.info(`[Queue] Queue service initialized and started (pool max: ${maxPool})`);
    } catch (error) {
      logger.error("[Queue] Failed to initialize queue service:", error);
      throw error;
    }
  }

  /**
   * Stop the queue system
   */
  public async stop(options: PgBoss.StopOptions = {}): Promise<void> {
    if (this.boss) {
      await this.boss.stop({
        graceful: true,
        wait: true,
        ...options,
      });
      this.isReady = false;
      this.workerRegistered = false;
      this.boss = null;
      this.ensuredQueues.clear();
      logger.info("[Queue] Queue service stopped");
    }
  }

  private async ensureQueue(queueName: string): Promise<void> {
    if (!this.boss) {
      throw new Error("Queue service not initialized");
    }

    if (this.ensuredQueues.has(queueName)) {
      return;
    }

    const queueOptions = QUEUE_OPTIONS[queueName] ?? { name: queueName };

    await this.boss.createQueue(queueName, queueOptions);

    if (QUEUE_OPTIONS[queueName]) {
      await this.boss.updateQueue(queueName, queueOptions);
    }

    this.ensuredQueues.add(queueName);
  }

  /**
   * Add a job to the queue
   */
  public async addJob(
    queueName: string,
    data: any,
    options: PgBoss.SendOptions = {}
  ): Promise<string | null> {
    if (!this.boss || !this.isReady) {
      const message = `[Queue] Attempted to add job but queue is not ready. boss: ${!!this.boss}, isReady: ${this.isReady}`;
      logger.error(message);
      throw new Error(message);
    }

    try {
      await this.ensureQueue(queueName);

      // Default options
      const jobOptions: PgBoss.SendOptions = {
        retryLimit: 3,
        retryDelay: 60, // 1 minute
        expireInMinutes: 15, // Job timeout
        ...options
      };

      const jobId = await this.boss.send(queueName, data, jobOptions);
      
      if (!jobId) {
         logger.info(`[Queue] Job was not enqueued to ${queueName}; pg-boss treated it as a duplicate or constrained job. Params: ${JSON.stringify(jobOptions)}`);
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
      await this.ensureQueue(queueName);

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
              throw error;
            }
        }
      });

      this.workerRegistered = true;
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
      return { status: "stopped", workerRegistered: this.workerRegistered };
    }

    try {
      return {
        status: "active",
        workerRegistered: this.workerRegistered,
        queues: Object.values(QUEUES)
      };
    } catch (error) {
      logger.error("[Queue] Failed to get health stats:", error);
      return { status: "error", error: String(error), workerRegistered: this.workerRegistered };
    }
  }
}

export const queueService = QueueService.getInstance();
