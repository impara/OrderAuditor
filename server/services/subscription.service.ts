import { storage, FREE_TIER_ORDER_LIMIT } from "../storage";
import {
  parseAppSubscriptionChargeId,
  shouldProcessAppSubscriptionTermination,
} from "../utils/app-subscription";
import { logger } from "../utils/logger";
import type { Subscription } from "@shared/schema";


export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  subscription: Subscription;
}

export class SubscriptionService {
  /**
   * Check if shop has quota remaining for order processing
   */
  async checkQuota(shopDomain: string): Promise<QuotaCheckResult> {
    // Get or initialize subscription
    let subscription = await storage.getSubscription(shopDomain);
    if (!subscription) {
      subscription = await storage.initializeSubscription(shopDomain);
    }

    const now = new Date();

    // Check if billing period has expired
    if (
      subscription.currentBillingPeriodEnd &&
      now > new Date(subscription.currentBillingPeriodEnd)
    ) {
      logger.info(`[Subscription] Billing period expired for ${shopDomain}`);

      // If subscription is in a temporary paid state, downgrade when the period ends.
      if (
        subscription.tier === "paid" &&
        (subscription.status === "cancelled" ||
          subscription.status === "complimentary")
      ) {
        logger.info(
          `[Subscription] Temporary paid period ended for ${shopDomain}, downgrading to free tier`
        );
        // Downgrade to free tier and reset order count and billing period for new free tier period
        // Do this atomically to prevent re-processing the same expired period
        const periodStart = new Date();
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + 30);

        subscription = await storage.updateSubscription(shopDomain, {
          tier: "free",
          status: "active",
          orderLimit: FREE_TIER_ORDER_LIMIT,
          monthlyOrderCount: 0,
          currentBillingPeriodStart: periodStart,
          currentBillingPeriodEnd: periodEnd,
        });

      } else {
        // Just reset the count for the new period (whether free or paid)
        logger.info(`[Subscription] Resetting order count for ${shopDomain}`);
        subscription = await storage.resetMonthlyOrderCount(shopDomain);
      }
    }

    if (subscription.status === "frozen") {
      return {
        allowed: false,
        reason:
          "Duplicate Guard is paused while your Shopify subscription is frozen (for example, when the store is closed). It will resume automatically when Shopify reactivates the subscription.",
        subscription,
      };
    }

    // Check quota
    // -1 means unlimited (paid tier)
    if (subscription.orderLimit === -1) {
      return {
        allowed: true,
        subscription,
      };
    }

    // Check if limit reached
    if (subscription.monthlyOrderCount >= subscription.orderLimit) {
      return {
        allowed: false,
        reason: `Monthly order limit (${subscription.orderLimit}) reached. Please upgrade to continue processing orders.`,
        subscription,
      };
    }

    return {
      allowed: true,
      subscription,
    };
  }

  /**
   * Increment order count for a shop
   */
  async recordOrder(shopDomain: string): Promise<Subscription> {
    return storage.incrementOrderCount(shopDomain);
  }

  /**
   * Get subscription for a shop
   */
  async getSubscription(shopDomain: string): Promise<Subscription> {
    let subscription = await storage.getSubscription(shopDomain);
    if (!subscription) {
      subscription = await storage.initializeSubscription(shopDomain);
    }
    return subscription;
  }

  /**
   * Activate paid subscription and persist the Shopify charge ID when known.
   */
  async activatePaidSubscription(
    shopDomain: string,
    shopifyChargeId?: string | number | null
  ): Promise<Subscription> {
    const updates: {
      tier: "paid";
      status: "active";
      orderLimit: number;
      shopifyChargeId?: string;
    } = {
      tier: "paid",
      status: "active",
      orderLimit: -1,
    };

    if (shopifyChargeId != null && shopifyChargeId !== "") {
      updates.shopifyChargeId = String(shopifyChargeId);
    }

    return storage.updateSubscription(shopDomain, updates);
  }

  /**
   * Pause paid access while Shopify has the subscription in FROZEN state
   * (e.g. store closed). Does not cancel billing or downgrade tier.
   */
  async freezePaidSubscription(
    shopDomain: string,
    shopifyChargeId?: string | number | null
  ): Promise<Subscription> {
    const updates: {
      status: "frozen";
      tier: "paid";
      orderLimit: number;
      shopifyChargeId?: string;
    } = {
      status: "frozen",
      tier: "paid",
      orderLimit: -1,
    };

    if (shopifyChargeId != null && shopifyChargeId !== "") {
      updates.shopifyChargeId = String(shopifyChargeId);
    }

    return storage.updateSubscription(shopDomain, updates);
  }

  /**
   * Sync local subscription state from app_subscriptions/update webhook payload.
   */
  async syncAppSubscriptionWebhook(
    shopDomain: string,
    appSubscription: Record<string, unknown>
  ): Promise<void> {
    const webhookStatus = String(appSubscription.status || "");
    const webhookChargeId = parseAppSubscriptionChargeId(appSubscription);
    const local = await this.getSubscription(shopDomain);

    logger.info(
      `[Subscription] Webhook ${webhookStatus} for ${shopDomain}. webhookChargeId=${webhookChargeId ?? "unknown"} storedChargeId=${local.shopifyChargeId ?? "none"}`
    );

    if (webhookStatus === "ACTIVE") {
      await this.activatePaidSubscription(shopDomain, webhookChargeId);
      return;
    }

    if (webhookStatus === "FROZEN") {
      if (
        local.shopifyChargeId &&
        webhookChargeId &&
        local.shopifyChargeId !== webhookChargeId
      ) {
        logger.info(
          `[Subscription] Ignoring FROZEN webhook for ${shopDomain} because it does not match active charge ${local.shopifyChargeId}`
        );
        return;
      }

      logger.info(
        `[Subscription] Pausing ${shopDomain} for frozen Shopify subscription`
      );
      await this.freezePaidSubscription(shopDomain, webhookChargeId);
      return;
    }

    if (
      ["CANCELLED", "DECLINED", "EXPIRED"].includes(webhookStatus)
    ) {
      if (
        !shouldProcessAppSubscriptionTermination(
          webhookChargeId,
          local.shopifyChargeId,
          local.status,
          local.tier,
          webhookStatus
        )
      ) {
        logger.info(
          `[Subscription] Ignoring ${webhookStatus} webhook for ${shopDomain} because it does not match active charge ${local.shopifyChargeId ?? "none"}`
        );
        return;
      }

      logger.info(
        `[Subscription] Processing ${webhookStatus} webhook for ${shopDomain}`
      );
      await this.cancelSubscription(shopDomain);
    }
  }

  /**
   * Update subscription tier
   */
  async updateTier(
    shopDomain: string,
    tier: "free" | "paid",
    orderLimit?: number
  ): Promise<Subscription> {
    const subscription = await this.getSubscription(shopDomain);

    const updates: any = {
      tier,
      // If we are upgrading to paid, status should be active
      // If we are downgrading to free, status should be active (as in "active free plan")
      status: "active",
    };

    if (orderLimit !== undefined) {
      updates.orderLimit = orderLimit;
    } else if (tier === "paid") {
      updates.orderLimit = -1; // Unlimited for paid tier
    } else {
      updates.orderLimit = FREE_TIER_ORDER_LIMIT; // Free tier limit
    }


    return storage.updateSubscription(shopDomain, updates);
  }

  /**
   * Cancel subscription
   * If current billing period is still valid and tier is paid, keep paid tier until end of period (grace period).
   * Otherwise, downgrade immediately.
   */
  async cancelSubscription(shopDomain: string): Promise<Subscription> {
    const subscription = await this.getSubscription(shopDomain);
    const now = new Date();

    // If we have a billing period end date in the future AND tier is paid, enter grace period
    if (
      subscription.tier === "paid" &&
      subscription.currentBillingPeriodEnd &&
      new Date(subscription.currentBillingPeriodEnd) > now
    ) {
      logger.info(
        `[Subscription] Cancelling ${shopDomain} with grace period until ${subscription.currentBillingPeriodEnd}`
      );
      return storage.updateSubscription(shopDomain, {
        status: "cancelled",
        // Keep tier as paid and orderLimit as -1
      });
    }

    // Otherwise downgrade immediately
    logger.info(
      `[Subscription] Cancelling ${shopDomain} immediately (no active period or not paid tier)`
    );
    return this.updateTier(shopDomain, "free", FREE_TIER_ORDER_LIMIT);

  }
}

export const subscriptionService = new SubscriptionService();
