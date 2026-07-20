import { logger } from "../utils/logger";
import { subscriptionService } from "./subscription.service";
import { fetchWithRetry, fetchBillingWithRetry } from "../utils/fetch-with-retry";
import { withShopBillingLock } from "../utils/shop-billing-lock";

export interface ShopifyRecurringCharge {
  id: number;
  name: string;
  price: string;
  status: string;
  return_url: string;
  confirmation_url?: string;
}

export type ShopifyAppSubscriptionStatus =
  | "ACTIVE"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN";

export interface ShopifyAppSubscription {
  id: string;
  name: string;
  status: ShopifyAppSubscriptionStatus;
  createdAt: string;
  currentPeriodEnd: string | null;
  test: boolean;
}

export interface ShopifyBillingSnapshot {
  active: ShopifyAppSubscription[];
  history: ShopifyAppSubscription[];
  fetchedAt: Date;
}

export type UpgradeChargeResult =
  | { kind: "pending"; charge: ShopifyRecurringCharge }
  | { kind: "active"; charge: ShopifyRecurringCharge }
  | { kind: "created"; charge: ShopifyRecurringCharge }
  | { kind: "failed" };

export class BillingSnapshotError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BillingSnapshotError";
  }
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

  async getBillingSnapshot(
    shopDomain: string,
    accessToken: string
  ): Promise<ShopifyBillingSnapshot> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      throw new BillingSnapshotError("Shopify credentials not provided");
    }

    const query = `query BillingSnapshot {
      currentAppInstallation {
        activeSubscriptions { id name status createdAt currentPeriodEnd test }
        allSubscriptions(first: 25, sortKey: CREATED_AT, reverse: true) {
          nodes { id name status createdAt currentPeriodEnd test }
        }
      }
    }`;

    let response: Response;
    try {
      response = await fetchWithRetry(
        `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
          idempotent: true,
          label: `getBillingSnapshot(${shopDomain})`,
        }
      );
    } catch (error) {
      throw new BillingSnapshotError(
        `Shopify billing query failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }

    if (!response.ok) {
      throw new BillingSnapshotError(
        `Shopify billing query returned HTTP ${response.status}`,
        response.status
      );
    }

    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new BillingSnapshotError("Shopify billing query returned GraphQL errors");
    }

    const installation = payload.data?.currentAppInstallation;
    const active = installation?.activeSubscriptions;
    const history = installation?.allSubscriptions?.nodes;
    if (!Array.isArray(active) || !Array.isArray(history)) {
      throw new BillingSnapshotError("Malformed Shopify billing response");
    }

    const validateSubscription = (value: any): ShopifyAppSubscription => {
      if (
        typeof value?.id !== "string" ||
        typeof value?.name !== "string" ||
        typeof value?.status !== "string" ||
        typeof value?.createdAt !== "string" ||
        typeof value?.test !== "boolean" ||
        (value.currentPeriodEnd !== null &&
          typeof value.currentPeriodEnd !== "string")
      ) {
        throw new BillingSnapshotError("Malformed Shopify subscription entry");
      }
      if (Number.isNaN(Date.parse(value.createdAt))) {
        throw new BillingSnapshotError("Malformed Shopify subscription createdAt");
      }
      if (
        value.currentPeriodEnd !== null &&
        Number.isNaN(Date.parse(value.currentPeriodEnd))
      ) {
        throw new BillingSnapshotError("Malformed Shopify currentPeriodEnd");
      }
      return value as ShopifyAppSubscription;
    };

    return {
      active: active.map(validateSubscription),
      history: history.map(validateSubscription),
      fetchedAt: new Date(),
    };
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

      // Use test charges on development stores (required for app review)
      // Set SHOPIFY_BILLING_TEST_MODE=true for review/dev stores
      // Set SHOPIFY_BILLING_TEST_MODE=false for production (real charges)
      const isTestMode = process.env.SHOPIFY_BILLING_TEST_MODE === 'true';
      const isBypassMode = process.env.SHOPIFY_BILLING_BYPASS === 'true';

      if (isBypassMode) {
        logger.warn(
          `[ShopifyBilling] BYPASS MODE ENABLED: Skipping Shopify Billing API call for ${shopDomain}. Simulating successful charge creation.`
        );

        const mockChargeId = Math.floor(Math.random() * 1000000);
        // Simulate created charge
        const mockCharge: ShopifyRecurringCharge = {
          id: mockChargeId,
          name: "Duplicate Guard - Unlimited Plan (Bypass)",
          price: "7.99",
          status: "pending",
          return_url: returnUrl,
          // In bypass mode, we redirect immediately to the return URL (success page)
          // The frontend expects a confirmation_url to redirect to. We set it to the returnUrl
          // so the user is "confirmed" immediately by the browser.
          // We append the mock charge ID so the frontend detects it and calls activate()
          confirmation_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}charge_id=${mockChargeId}`, 
        };
        return mockCharge;
      }

      this.logBillingMode(shopDomain, isTestMode);



      // Only include 'test' field when in test mode
      // Per Shopify: "make sure the test flag is set to null" for production
      const chargeData = {
        recurring_application_charge: {
          name: "Duplicate Guard - Unlimited Plan",
          price: "7.99",
          return_url: returnUrl,
          ...(isTestMode && { test: true }),
        },
      };

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

    if (process.env.SHOPIFY_BILLING_BYPASS === 'true') {
      logger.warn(
        `[ShopifyBilling] BYPASS MODE ENABLED: Skipping active charge check for ${shopDomain}. Upgrading subscription immediately.`
      );
      await subscriptionService.activatePaidSubscription(shopDomain, chargeId, accessToken);
      return true;
    }

    try {
      const existingCharge = await this.getCharge(shopDomain, accessToken, chargeId);
      if (existingCharge?.status === "ACTIVE") {
        await subscriptionService.activatePaidSubscription(shopDomain, chargeId, accessToken);
        logger.info(
          `[ShopifyBilling] Charge ${chargeId} already active; synced subscription`
        );
        return true;
      }

      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/recurring_application_charges/${chargeId}/activate.json`;

      const response = await fetchBillingWithRetry(url, {
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
        confirmedIdempotent: true,
        label: `activateCharge(${shopDomain}, ${chargeId})`,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to activate charge: ${response.status}`,
          errorText
        );

        const chargeAfterFailure = await this.getCharge(
          shopDomain,
          accessToken,
          chargeId
        );
        if (chargeAfterFailure?.status === "ACTIVE") {
          await subscriptionService.activatePaidSubscription(
            shopDomain,
            chargeId,
            accessToken
          );
          logger.info(
            `[ShopifyBilling] Charge ${chargeId} became active after retry/read-after-write`
          );
          return true;
        }

        return false;
      }

      await subscriptionService.activatePaidSubscription(shopDomain, chargeId, accessToken);

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

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        label: `getCharge(${shopDomain}, ${chargeId})`,
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

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        label: `listCharges(${shopDomain})`,
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

  async getOrCreateUpgradeCharge(
    shopDomain: string,
    accessToken: string,
    returnUrl: string
  ): Promise<UpgradeChargeResult> {
    return withShopBillingLock(shopDomain, async () => {
      const existing = await this.handleExistingCharges(
        shopDomain,
        accessToken,
        returnUrl
      );

      if (existing.hasPendingCharge && existing.pendingCharge) {
        return { kind: "pending", charge: existing.pendingCharge };
      }
      if (existing.hasActiveCharge && existing.activeCharge) {
        return { kind: "active", charge: existing.activeCharge };
      }

      const charge = await this.createRecurringCharge(
        shopDomain,
        accessToken,
        returnUrl
      );
      return charge
        ? { kind: "created", charge }
        : { kind: "failed" };
    });
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

      const response = await fetchWithRetry(url, {
        method: "DELETE",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        idempotent: true,
        label: `cancelCharge(${shopDomain}, ${chargeId})`,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[ShopifyBilling] Failed to cancel charge: ${response.status}`,
          errorText
        );
        return false;
      }

      logger.info(
        `[ShopifyBilling] Cancelled charge ${chargeId} for ${shopDomain}. Caller is responsible for downgrading subscription.`
      );
      return true;

    } catch (error) {
      logger.error("[ShopifyBilling] Error cancelling charge:", error);
      return false;
    }
  }

  private logBillingMode(shopDomain: string, isTestMode: boolean) {
    logger.info(
      `[ShopifyBilling] Creating ${
        isTestMode ? "TEST" : "LIVE"
      } recurring charge for ${shopDomain}`
    );
  }
}

export const shopifyBillingService = new ShopifyBillingService();
