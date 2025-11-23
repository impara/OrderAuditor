import { storage } from "../storage";
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

    // Check if billing period has expired and reset if needed
    if (subscription.currentBillingPeriodEnd && new Date() > new Date(subscription.currentBillingPeriodEnd)) {
      logger.info(`[Subscription] Billing period expired for ${shopDomain}, resetting order count`);
      subscription = await storage.resetMonthlyOrderCount(shopDomain);
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
      status: "active",
    };

    if (orderLimit !== undefined) {
      updates.orderLimit = orderLimit;
    } else if (tier === "paid") {
      updates.orderLimit = -1; // Unlimited for paid tier
    } else {
      updates.orderLimit = 50; // Free tier limit
    }

    return storage.updateSubscription(shopDomain, updates);
  }

  /**
   * Cancel subscription (downgrade to free)
   */
  async cancelSubscription(shopDomain: string): Promise<Subscription> {
    return this.updateTier(shopDomain, "free", 50);
  }
}

export const subscriptionService = new SubscriptionService();


