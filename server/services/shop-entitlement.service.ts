import type { Subscription } from "@shared/schema";
import { fetchWithRetry } from "../utils/fetch-with-retry";
import { logger } from "../utils/logger";

export type ShopEntitlementSource =
  | "paid_subscription"
  | "partner_development"
  | "free";

export interface ShopEntitlement {
  source: ShopEntitlementSource;
  hasPaidFeatures: boolean;
  partnerDevelopment: boolean;
}

const FREE_ENTITLEMENT: ShopEntitlement = {
  source: "free",
  hasPaidFeatures: false,
  partnerDevelopment: false,
};

export class ShopEntitlementService {
  private readonly apiVersion = "2025-10";

  private hasLocalPaidAccess(subscription: Subscription): boolean {
    return (
      subscription.tier === "paid" &&
      subscription.status !== "frozen"
    );
  }

  async resolve(
    shopDomain: string,
    accessToken: string | undefined,
    subscription: Subscription
  ): Promise<ShopEntitlement> {
    if (this.hasLocalPaidAccess(subscription)) {
      return {
        source: "paid_subscription",
        hasPaidFeatures: true,
        partnerDevelopment: false,
      };
    }

    if (!shopDomain || !accessToken) {
      return { ...FREE_ENTITLEMENT };
    }

    const query = `query ShopPlanEntitlement {
      shop { plan { partnerDevelopment } }
    }`;

    try {
      const response = await fetchWithRetry(
        `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
          idempotent: true,
          label: `getShopPlanEntitlement(${shopDomain})`,
        }
      );

      if (!response.ok) {
        logger.warn(
          `[Entitlement] Shopify plan query returned HTTP ${response.status} for ${shopDomain}; using free access`
        );
        return { ...FREE_ENTITLEMENT };
      }

      const payload = await response.json();
      const partnerDevelopment = payload.data?.shop?.plan?.partnerDevelopment;
      if (
        (Array.isArray(payload.errors) && payload.errors.length > 0) ||
        typeof partnerDevelopment !== "boolean"
      ) {
        logger.warn(
          `[Entitlement] Shopify plan query was malformed for ${shopDomain}; using free access`
        );
        return { ...FREE_ENTITLEMENT };
      }

      if (partnerDevelopment) {
        return {
          source: "partner_development",
          hasPaidFeatures: true,
          partnerDevelopment: true,
        };
      }

      return { ...FREE_ENTITLEMENT };
    } catch (error) {
      logger.warn(
        `[Entitlement] Shopify plan query failed for ${shopDomain}; using free access`,
        error
      );
      return { ...FREE_ENTITLEMENT };
    }
  }

  async handleShopUpdate(
    shopDomain: string,
    accessToken: string | undefined,
    subscription: Subscription
  ): Promise<ShopEntitlement> {
    const entitlement = await this.resolve(shopDomain, accessToken, subscription);
    logger.info(
      `[Entitlement] Reconciled shop/update for ${shopDomain}: ${entitlement.source}`
    );
    return entitlement;
  }
}

export const shopEntitlementService = new ShopEntitlementService();
