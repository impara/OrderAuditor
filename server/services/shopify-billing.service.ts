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
   * Get test mode setting from environment variable
   * Defaults to false (production mode) unless explicitly set to "true"
   *
   * IMPORTANT: Test charges (test: true) can ONLY be created in Shopify development stores.
   * Attempting to create a test charge in a production store will result in a 403 Forbidden error.
   * Set BILLING_TEST_MODE=true only when testing with development stores.
   */
  private isTestMode(): boolean {
    const testMode = process.env.BILLING_TEST_MODE?.toLowerCase();
    return testMode === "true" || testMode === "1";
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

    try {
      const testMode = this.isTestMode();
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges.json`;

      const chargeData = {
        recurring_application_charge: {
          name: "Duplicate Guard - Unlimited Plan",
          price: 7.99,
          return_url: returnUrl,
          test: testMode, // Configurable test mode via BILLING_TEST_MODE env var
        },
      };

      logger.info(
        `[ShopifyBilling] Creating recurring charge for ${shopDomain} - Test mode: ${testMode}, BILLING_TEST_MODE: ${
          process.env.BILLING_TEST_MODE || "not set"
        }`
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
          testMode,
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
            1. App not installed via OAuth flow (CRITICAL): Partner Apps MUST be installed through OAuth, not as custom apps
            2. Store is not a development store (required for test charges with test: true)
            3. Access token from custom app installation (custom apps don't have billing API access)
            4. App not properly configured in Shopify Partner Dashboard
            SOLUTION: Reinstall the app through the OAuth flow (/api/auth) to get proper billing permissions`
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
