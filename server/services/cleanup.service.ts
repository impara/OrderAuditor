import { db } from "../db";
import { webhookDeliveries } from "@shared/schema";
import { sql, lt } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * CleanupService handles periodic maintenance tasks to prevent
 * unbounded table growth and maintain database performance.
 */
export class CleanupService {
  /**
   * Delete webhook deliveries older than the specified number of days.
   * The webhook_deliveries table is used for idempotency checks and grows
   * with every webhook received. Old entries are no longer needed once
   * past the typical Shopify retry window (usually within 48 hours).
   * 
   * @param daysToKeep - Number of days of webhook deliveries to retain (default: 7)
   * @returns Number of deleted records
   */
  async cleanupOldWebhookDeliveries(daysToKeep = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    logger.info(
      `[Cleanup] Starting webhook delivery cleanup, removing records older than ${cutoffDate.toISOString()}`
    );

    try {
      const result = await db
        .delete(webhookDeliveries)
        .where(lt(webhookDeliveries.processedAt, cutoffDate))
        .returning({ id: webhookDeliveries.id });

      logger.info(
        `[Cleanup] Deleted ${result.length} old webhook delivery records`
      );
      return result.length;
    } catch (error) {
      logger.error(`[Cleanup] Failed to cleanup webhook deliveries: ${error}`);
      throw error;
    }
  }

  /**
   * Run all cleanup tasks.
   * This can be called from a cron job or scheduled task.
   */
  async runAllCleanupTasks(): Promise<void> {
    logger.info("[Cleanup] Starting scheduled cleanup tasks");
    
    try {
      await this.cleanupOldWebhookDeliveries();
      logger.info("[Cleanup] All cleanup tasks completed successfully");
    } catch (error) {
      logger.error(`[Cleanup] Cleanup tasks failed: ${error}`);
      throw error;
    }
  }
}

export const cleanupService = new CleanupService();
