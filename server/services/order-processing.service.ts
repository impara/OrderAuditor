import type { InsertOrder, Order } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../utils/logger";
import {
  duplicateDetectionService,
  HISTORICAL_SCAN_MATCHING_PROFILE,
  type DuplicateDetectionMetadata,
  type DuplicateMatch,
} from "./duplicate-detection.service";
import { notificationService } from "./notification.service";
import { shopifyService } from "./shopify.service";
import { subscriptionService } from "./subscription.service";

export type ProcessOrderOptions =
  | { mode: "live" }
  | { mode: "historical"; scanRunId: string };

export interface ProcessOrderResult {
  order: Order | null;
  match: DuplicateMatch | null;
  skippedReason?: "quota" | "existing";
  candidateCapExceeded: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("duplicate key") || message.includes("unique constraint");
}

async function ensureLiveTag(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string
): Promise<void> {
  try {
    await shopifyService.tagOrder(shopDomain, accessToken, shopifyOrderId, [
      "Merge_Review_Candidate",
    ]);
  } catch (error) {
    logger.error(
      `[OrderProcessing] Failed to ensure Shopify tag for ${shopifyOrderId}:`,
      error
    );
  }
}

export async function processOrder(
  order: InsertOrder,
  accessToken: string,
  options: ProcessOrderOptions
): Promise<ProcessOrderResult> {
  const existing = await storage.getOrderByShopifyId(
    order.shopDomain,
    order.shopifyOrderId
  );

  if (existing) {
    if (options.mode === "live") {
      if (existing.isFlagged && existing.flagSource === "live") {
        await ensureLiveTag(order.shopDomain, accessToken, order.shopifyOrderId);
      }
      return { order: existing, match: null, skippedReason: "existing", candidateCapExceeded: false };
    }

    if (existing.isFlagged || existing.resolvedAt || existing.resolvedBy) {
      return { order: existing, match: null, skippedReason: "existing", candidateCapExceeded: false };
    }
  }

  if (options.mode === "live") {
    const quota = await subscriptionService.checkQuota(order.shopDomain);
    if (!quota.allowed) {
      if (
        quota.subscription.orderLimit !== -1 &&
        quota.subscription.monthlyOrderCount >= quota.subscription.orderLimit
      ) {
        try {
          await notificationService.sendQuotaExceededNotification(
            order.shopDomain,
            quota.subscription
          );
        } catch (error) {
          logger.warn("[OrderProcessing] Failed to send quota notification:", error);
        }
      }
      return { order: null, match: null, skippedReason: "quota", candidateCapExceeded: false };
    }
  }

  const detectionMetadata: DuplicateDetectionMetadata = {
    candidateCapExceeded: false,
  };
  const match = await duplicateDetectionService.findDuplicates(
    order,
    order.shopDomain,
    detectionMetadata,
    options.mode === "historical"
      ? HISTORICAL_SCAN_MATCHING_PROFILE
      : undefined
  );
  const persistenceValues = {
    ...order,
    isFlagged: Boolean(match),
    flagSource: options.mode,
    flaggedByScanRunId:
      match && options.mode === "historical" ? options.scanRunId : null,
    matchConfidence: match ? Math.round(match.confidence) : 0,
    matchReason: match?.matchReason ?? null,
    duplicateOfOrderId: match?.order.id ?? null,
    flaggedAt: match ? new Date() : null,
  };

  let storedOrder: Order;
  if (existing) {
    storedOrder = await storage.updateOrder(
      order.shopDomain,
      existing.id,
      persistenceValues
    );
  } else {
    try {
      storedOrder = await storage.createOrder(persistenceValues);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const racedOrder = await storage.getOrderByShopifyId(
        order.shopDomain,
        order.shopifyOrderId
      );
      if (!racedOrder) {
        throw error;
      }
      if (
        options.mode === "historical" &&
        !racedOrder.isFlagged &&
        !racedOrder.resolvedAt &&
        !racedOrder.resolvedBy
      ) {
        storedOrder = await storage.updateOrder(
          order.shopDomain,
          racedOrder.id,
          persistenceValues
        );
      } else {
        return { order: racedOrder, match: null, skippedReason: "existing", candidateCapExceeded: false };
      }
    }
  }

  if (options.mode === "live" && match) {
    await ensureLiveTag(order.shopDomain, accessToken, order.shopifyOrderId);

    try {
      const settings = await storage.getSettings(order.shopDomain);
      if (settings) {
        await notificationService.sendNotifications(order.shopDomain, settings, {
          order: storedOrder,
          duplicateOf: match.order,
          confidence: match.confidence,
          matchReason: match.matchReason,
        });
      }
    } catch (error) {
      logger.error("[OrderProcessing] Failed to send duplicate notification:", error);
    }

    try {
      const subscription = await subscriptionService.recordOrder(order.shopDomain);
      if (
        subscription.orderLimit !== -1 &&
        subscription.monthlyOrderCount >= subscription.orderLimit
      ) {
        await notificationService.sendQuotaExceededNotification(
          order.shopDomain,
          subscription
        );
      }
    } catch (error) {
      logger.warn("[OrderProcessing] Failed to update duplicate quota:", error);
    }
  }

  return {
    order: storedOrder,
    match,
    candidateCapExceeded: detectionMetadata.candidateCapExceeded,
  };
}
