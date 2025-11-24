import { logger } from "../utils/logger";
import { subscriptionService } from "./subscription.service";

interface ShopifyRecurringCharge {
  id: number;
  name: string;
  price: string;
  status: string;
  return_url: string;
  confirmation_url?: string;
}

export class ShopifyBillingService {
  private apiVersion: string = "2025-10";

  private getBaseApiUrl(shopDomain: string): string {
    return `https://${shopDomain}/admin/api/${this.apiVersion}`;
  }

  private validateCredentials(shopDomain: string, accessToken: string): boolean {
    if (!shopDomain || !accessToken) {
      logger.error("Shopify credentials not provided");
      return false;
    }
    return true;
  }

  /**
   * Create a recurring charge for $7.99/month
   */
  async createRecurringCharge(shopDomain: string, accessToken: string, returnUrl: string): Promise<ShopifyRecurringCharge | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/recurring_application_charges.json`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recurring_application_charge: {
            name: "Order Auditor - Unlimited Plan",
            price: 7.99,
            return_url: returnUrl,
            test: process.env.NODE_ENV !== "production", // Test mode in development
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to create charge: ${response.status}`,
          errorText
        );
        return null;
      }

      const data = await response.json();
      logger.info(`[ShopifyBilling] Created recurring charge: ${data.recurring_application_charge.id}`);
      return data.recurring_application_charge;
    } catch (error) {
      logger.error("[ShopifyBilling] Error creating recurring charge:", error);
      return null;
    }
  }

  /**
   * Activate a recurring charge after merchant approval
   */
  async activateCharge(shopDomain: string, accessToken: string, chargeId: number): Promise<boolean> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return false;
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/recurring_application_charges/${chargeId}/activate.json`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recurring_application_charge: {
            id: chargeId,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to activate charge: ${response.status}`,
          errorText
        );
        return false;
      }

      // Update subscription to paid tier
      await subscriptionService.updateTier(shopDomain, "paid", -1);
      
      logger.info(`[ShopifyBilling] Activated charge ${chargeId} and upgraded subscription`);
      return true;
    } catch (error) {
      logger.error("[ShopifyBilling] Error activating charge:", error);
      return false;
    }
  }

  /**
   * Get charge status
   */
  async getCharge(shopDomain: string, accessToken: string, chargeId: number): Promise<ShopifyRecurringCharge | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/recurring_application_charges/${chargeId}.json`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.recurring_application_charge;
    } catch (error) {
      logger.error("[ShopifyBilling] Error getting charge:", error);
      return null;
    }
  }

  /**
   * Cancel a recurring charge
   */
  async cancelCharge(shopDomain: string, accessToken: string, chargeId: number): Promise<boolean> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return false;
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/recurring_application_charges/${chargeId}.json`;
      
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to cancel charge: ${response.status}`,
          errorText
        );
        return false;
      }

      // Downgrade subscription to free tier
      await subscriptionService.cancelSubscription(shopDomain);
      
      logger.info(`[ShopifyBilling] Cancelled charge ${chargeId} and downgraded subscription`);
      return true;
    } catch (error) {
      logger.error("[ShopifyBilling] Error cancelling charge:", error);
      return false;
    }
  }
}

export const shopifyBillingService = new ShopifyBillingService();


