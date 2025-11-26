import crypto from "crypto";
import { logger } from "../utils/logger";

interface ShopifyWebhook {
  id: number;
  address: string;
  topic: string;
  created_at: string;
  updated_at: string;
  format: string;
}

interface WebhookRegistrationResult {
  success: boolean;
  webhook?: ShopifyWebhook;
  error?: string;
  message: string;
}

export class ShopifyService {
  private webhookSecret: string;
  private apiVersion: string = "2025-10";

  constructor() {
    // Shopify webhooks use a separate webhook secret for HMAC verification
    // This is different from the Client Secret (SHOPIFY_API_SECRET) used for OAuth
    // Priority: SHOPIFY_WEBHOOK_SECRET > SHOPIFY_API_SECRET (fallback for older apps)
    this.webhookSecret =
      process.env.SHOPIFY_WEBHOOK_SECRET ||
      process.env.SHOPIFY_API_SECRET ||
      "";

    if (!this.webhookSecret) {
      logger.error(
        "[ShopifyService] CRITICAL: Neither SHOPIFY_WEBHOOK_SECRET nor SHOPIFY_API_SECRET is set! Webhook verification will fail."
      );
    } else if (process.env.SHOPIFY_WEBHOOK_SECRET) {
      logger.info(
        "[ShopifyService] Using SHOPIFY_WEBHOOK_SECRET for webhook verification"
      );
    } else {
      logger.warn(
        "[ShopifyService] Using SHOPIFY_API_SECRET as fallback for webhook verification (consider setting SHOPIFY_WEBHOOK_SECRET)"
      );
    }
  }

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
   * Verify Shopify webhook HMAC signature
   * @param body - Raw request body as Buffer or string
   * @param hmacHeader - HMAC signature from X-Shopify-Hmac-Sha256 header
   */
  verifyWebhook(body: Buffer | string, hmacHeader: string): boolean {
    if (!this.webhookSecret) {
      logger.warn("[ShopifyService] SHOPIFY_WEBHOOK_SECRET not configured");
      return false;
    }

    logger.debug(`[ShopifyService] Verifying webhook signature...`);
    logger.debug(
      `[ShopifyService] Webhook secret length: ${this.webhookSecret.length}`
    );
    logger.debug(
      `[ShopifyService] HMAC header: ${hmacHeader.substring(0, 10)}...`
    );
    logger.debug(
      `[ShopifyService] Body length: ${
        Buffer.isBuffer(body) ? body.length : body.length
      } bytes`
    );

    // Calculate HMAC on raw bytes (Buffer) - Shopify calculates HMAC on raw request body
    const hash = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("base64");

    logger.debug(
      `[ShopifyService] Calculated hash: ${hash.substring(0, 10)}...`
    );
    logger.debug(
      `[ShopifyService] Expected hash:   ${hmacHeader.substring(0, 10)}...`
    );

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(hmacHeader)
      );
      logger.debug(`[ShopifyService] Signature validation result: ${isValid}`);
      return isValid;
    } catch (error: any) {
      logger.error("[ShopifyService] timingSafeEqual error:", error);
      logger.error(
        `[ShopifyService] Hash lengths - calculated: ${hash.length}, header: ${hmacHeader.length}`
      );
      return false;
    }
  }

  /**
   * List all registered webhooks
   */
  async listWebhooks(
    shopDomain: string,
    accessToken: string
  ): Promise<ShopifyWebhook[]> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return [];
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/webhooks.json`;
      logger.debug(`[Shopify] Fetching webhooks from: ${url}`);

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
          `[Shopify] Failed to list webhooks: ${response.status} ${response.statusText}`,
          errorText
        );
        throw new Error(
          `Shopify API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.webhooks || [];
    } catch (error) {
      logger.error("[Shopify] Error listing webhooks:", error);
      throw error;
    }
  }

  /**
   * Register a new webhook
   */
  async registerWebhook(
    shopDomain: string,
    accessToken: string,
    topic: string,
    address: string
  ): Promise<WebhookRegistrationResult> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return {
        success: false,
        error: "Missing Shopify credentials",
        message: "shopDomain and accessToken must be provided",
      };
    }

    try {
      logger.info(
        `[Shopify] Registering webhook for topic: ${topic} at ${address}`
      );

      const existingWebhooks = await this.listWebhooks(shopDomain, accessToken);
      const duplicate = existingWebhooks.find(
        (wh) => wh.topic === topic && wh.address === address
      );

      if (duplicate) {
        logger.info(`[Shopify] Webhook already exists (ID: ${duplicate.id})`);
        return {
          success: true,
          webhook: duplicate,
          message: "Webhook already registered",
        };
      }

      const url = `${this.getBaseApiUrl(shopDomain)}/webhooks.json`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address,
            format: "json",
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `[Shopify] Failed to register webhook: ${response.status}`,
          errorText
        );
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          message: "Failed to register webhook with Shopify API",
        };
      }

      const data = await response.json();
      logger.info(
        `[Shopify] Successfully registered webhook (ID: ${data.webhook.id})`
      );

      return {
        success: true,
        webhook: data.webhook,
        message: "Webhook successfully registered",
      };
    } catch (error) {
      logger.error("[Shopify] Error registering webhook:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to register webhook due to an error",
      };
    }
  }

  /**
   * Fetch full order details by order ID
   */
  async getOrder(
    shopDomain: string,
    accessToken: string,
    orderId: number
  ): Promise<any | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    try {
      const url = `${this.getBaseApiUrl(shopDomain)}/orders/${orderId}.json`;
      logger.debug(`[Shopify] Fetching order ${orderId} via API`);

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
          `[Shopify] Failed to fetch order: ${response.status}`,
          errorText
        );
        return null;
      }

      const data = await response.json();
      return data.order || null;
    } catch (error: any) {
      // Handle 403 Forbidden specifically for Protected Customer Data
      if (error.message && error.message.includes("403")) {
        logger.warn(`[Shopify] ⚠️ Access denied (403) fetching order ${orderId}. Likely missing 'Protected Customer Data' access.`);
        return null;
      }
      logger.error("[Shopify] Error fetching order:", error);
      return null;
    }
  }

  /**
   * Fetch customer details by customer ID
   */
  async getCustomer(
    shopDomain: string,
    accessToken: string,
    customerId: number
  ): Promise<any | null> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return null;
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/customers/${customerId}.json`;
      logger.debug(`[Shopify] Fetching customer ${customerId} via API`);

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
          `[Shopify] Failed to fetch customer: ${response.status}`,
          errorText
        );
        return null;
      }

      const data = await response.json();
      return data.customer || null;
    } catch (error: any) {
      // Handle 403 Forbidden specifically for Protected Customer Data
      if (error.message && error.message.includes("403")) {
        logger.warn(`[Shopify] ⚠️ Access denied (403) fetching customer ${customerId}. Likely missing 'Protected Customer Data' access.`);
        return null;
      }
      logger.error("[Shopify] Error fetching customer:", error);
      return null;
    }
  }

  /**
   * Delete a webhook by ID
   */
  async deleteWebhook(
    shopDomain: string,
    accessToken: string,
    webhookId: number
  ): Promise<boolean> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      return false;
    }

    try {
      const url = `${this.getBaseApiUrl(
        shopDomain
      )}/webhooks/${webhookId}.json`;
      logger.info(`[Shopify] Deleting webhook ID: ${webhookId}`);

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
          `[Shopify] Failed to delete webhook: ${response.status}`,
          errorText
        );
        return false;
      }

      logger.info(`[Shopify] Successfully deleted webhook ID: ${webhookId}`);
      return true;
    } catch (error) {
      logger.error("[Shopify] Error deleting webhook:", error);
      return false;
    }
  }

  /**
   * Tag an order in Shopify as a duplicate
   */
  async tagOrder(
    shopDomain: string,
    accessToken: string,
    orderId: string,
    tags: string[]
  ): Promise<void> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      logger.warn("Shopify credentials not configured, skipping order tagging");
      return;
    }

    const url = `${this.getBaseApiUrl(shopDomain)}/orders/${orderId}.json`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order: {
            id: orderId,
            tags: tags.join(", "),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }
    } catch (error) {
      logger.error("Failed to tag order in Shopify:", error);
      throw error;
    }
  }

  /**
   * Remove a specific tag from an order in Shopify
   */
  async removeOrderTag(
    shopDomain: string,
    accessToken: string,
    orderId: string,
    tagToRemove: string
  ): Promise<void> {
    if (!this.validateCredentials(shopDomain, accessToken)) {
      logger.warn("Shopify credentials not configured, skipping tag removal");
      return;
    }

    try {
      // First, get the current order to see existing tags
      const url = `${this.getBaseApiUrl(shopDomain)}/orders/${orderId}.json`;
      const getResponse = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!getResponse.ok) {
        throw new Error(`Failed to fetch order: ${getResponse.statusText}`);
      }

      const data = await getResponse.json();
      const order = data.order;
      const currentTags = order.tags
        ? order.tags.split(", ").filter((t: string) => t.trim())
        : [];

      // Remove the specified tag
      const updatedTags = currentTags.filter(
        (tag: string) => tag.trim() !== tagToRemove.trim()
      );

      // Update the order with the new tags
      const updateResponse = await fetch(url, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order: {
            id: orderId,
            tags: updatedTags.join(", "),
          },
        }),
      });

      if (!updateResponse.ok) {
        throw new Error(`Shopify API error: ${updateResponse.statusText}`);
      }

      logger.info(
        `[Shopify] Removed tag "${tagToRemove}" from order ${orderId}`
      );
    } catch (error) {
      logger.error("Failed to remove tag from order in Shopify:", error);
      throw error;
    }
  }
}

export const shopifyService = new ShopifyService();
