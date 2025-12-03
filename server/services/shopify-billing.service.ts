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

  private validateCredentials(
    shopDomain: string,
    accessToken: string
  ): boolean {
    if (!shopDomain || !accessToken) {
      logger.error("Shopify credentials not provided");
      return false;
    }
    return true;
  }

  /**
   * Create a recurring charge for $7.99/month
   */
  async createRecurringCharge(
    shopDomain: string,
    accessToken: string,
    returnUrl: string
  ): Promise<ShopifyRecurringCharge | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    // Log token info for debugging (but don't block based on length)
    // Some test stores may have shorter tokens even through OAuth
    if (accessToken.length < 40) {
      logger.warn(
        `[ShopifyBilling] Access token is shorter than typical (${accessToken.length} chars). If billing fails, ensure app is installed via OAuth, not as custom app.`
      );
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges.json`;

      const chargeData = {
        recurring_application_charge: {
          name: "Duplicate Guard - Unlimited Plan",
          price: 7.99,
          return_url: returnUrl,
        },
      };

      logger.info(
        `[ShopifyBilling] Creating recurring charge for ${shopDomain}`
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chargeData),
      });

      if (!response.ok) {
        let errorText = "";
        let errorJson: any = null;

        try {
          errorText = await response.text();
          // Try to parse as JSON for better error details
          if (errorText) {
            try {
              errorJson = JSON.parse(errorText);
            } catch {
              // Not JSON, keep as text
            }
          }
        } catch (e) {
          errorText = `Failed to read error response: ${e}`;
        }

        const errorDetails = {
          shopDomain,
          status: response.status,
          statusText: response.statusText,
          errorResponse: errorText,
          errorJson: errorJson,
          requestBody: chargeData,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        };

        logger.error(
          `[ShopifyBilling] Failed to create charge: ${response.status} ${response.statusText}`,
          errorDetails
        );

        // Log specific guidance for 403 errors
        if (response.status === 403) {
          logger.error(
            `[ShopifyBilling] 403 Forbidden - Possible causes:
            1. Test/Development Store Limitation (MOST COMMON): Test stores created in Partner Dashboard CANNOT accept billing charges, even test charges. These stores are restricted to free apps only.
            2. App not installed via OAuth flow: Partner Apps MUST be installed through OAuth, not as custom apps
            3. Access token from custom app installation: Custom apps don't have billing API access
            4. App not properly configured in Shopify Partner Dashboard
            SOLUTIONS:
            - For testing: Create a non-test development store (can be transferred/upgraded) OR install on a real store outside partner account
            - For production: Ensure app is installed via OAuth on a real store (not a test store)
            - Reinstall app through OAuth: ${
              process.env.APP_URL || "your-app-url"
            }/api/auth?shop=${shopDomain}`
          );
        }

        return null;
      }

      const data = await response.json();
      logger.info(
        `[ShopifyBilling] Created recurring charge: ${data.recurring_application_charge.id}`
      );
      return data.recurring_application_charge;
    } catch (error) {
      logger.error("[ShopifyBilling] Error creating recurring charge:", error);
      return null;
    }
  }

  /**
   * Activate a recurring charge after merchant approval
   */
  async activateCharge(
    shopDomain: string,
    accessToken: string,
    chargeId: number
  ): Promise<boolean> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return false;
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges/${chargeId}/activate.json`;

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

      logger.info(
        `[ShopifyBilling] Activated charge ${chargeId} and upgraded subscription`
      );
      return true;
    } catch (error) {
      logger.error("[ShopifyBilling] Error activating charge:", error);
      return false;
    }
  }

  /**
   * Get charge status
   */
  async getCharge(
    shopDomain: string,
    accessToken: string,
    chargeId: number
  ): Promise<ShopifyRecurringCharge | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges/${chargeId}.json`;

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
   * List all recurring charges for a shop
   * Used to check for existing pending charges on reinstall
   */
  async listCharges(
    shopDomain: string,
    accessToken: string
  ): Promise<ShopifyRecurringCharge[]> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return [];
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges.json`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to list charges: ${response.status}`,
          errorText
        );
        return [];
      }

      const data = await response.json();
      return data.recurring_application_charges || [];
    } catch (error) {
      logger.error("[ShopifyBilling] Error listing charges:", error);
      return [];
    }
  }

  /**
   * Check for existing pending charges and handle them appropriately
   * This is required by Shopify: apps must handle charge acceptance/decline/approval on reinstall
   */
  async handleExistingCharges(
    shopDomain: string,
    accessToken: string,
    returnUrl: string
  ): Promise<{
    hasPendingCharge: boolean;
    pendingCharge: ShopifyRecurringCharge | null;
    hasActiveCharge: boolean;
    activeCharge: ShopifyRecurringCharge | null;
  }> {
    const charges = await this.listCharges(shopDomain, accessToken);

    // Shopify API returns statuses in uppercase (PENDING, ACTIVE, etc.)
    const pendingCharge =
      charges.find((charge) => charge.status === "PENDING") || null;

    const activeCharge =
      charges.find((charge) => charge.status === "ACTIVE") || null;

    // If there's an active charge, ensure subscription is synced
    if (activeCharge) {
      logger.info(
        `[ShopifyBilling] Found active charge ${activeCharge.id} for ${shopDomain}. Syncing subscription.`
      );
      await subscriptionService.updateTier(shopDomain, "paid", -1);
    }

    // If there's a pending charge, log it (merchant needs to approve it)
    if (pendingCharge) {
      logger.info(
        `[ShopifyBilling] Found pending charge ${pendingCharge.id} for ${shopDomain}. Merchant approval required.`
      );
    }

    return {
      hasPendingCharge: !!pendingCharge,
      pendingCharge,
      hasActiveCharge: !!activeCharge,
      activeCharge,
    };
  }

  /**
   * Cancel a recurring charge
   */
  async cancelCharge(
    shopDomain: string,
    accessToken: string,
    chargeId: number
  ): Promise<boolean> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return false;
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges/${chargeId}.json`;

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

      logger.info(
        `[ShopifyBilling] Cancelled charge ${chargeId} and downgraded subscription`
      );
      return true;
    } catch (error) {
      logger.error("[ShopifyBilling] Error cancelling charge:", error);
      return false;
    }
  }
}

export const shopifyBillingService = new ShopifyBillingService();
