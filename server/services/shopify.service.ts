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
  private shopDomain: string;
  private accessToken: string;
  private webhookSecret: string;
  private apiVersion: string = "2025-10";

  constructor() {
    this.shopDomain = process.env.SHOPIFY_SHOP_DOMAIN || "";
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN || "";
    this.webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  }

  private get baseApiUrl(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
  }

  private validateCredentials(): boolean {
    if (!this.shopDomain || !this.accessToken) {
      logger.error("Shopify credentials not configured");
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

    logger.debug("[ShopifyService] Verifying webhook HMAC");
    logger.debug(
      "[ShopifyService] Secret configured:",
      this.webhookSecret.substring(0, 10) + "..."
    );
    logger.debug(
      "[ShopifyService] Body type:",
      typeof body,
      "isBuffer:",
      Buffer.isBuffer(body)
    );
    logger.debug("[ShopifyService] Body length:", body.length);
    logger.debug("[ShopifyService] HMAC header received:", hmacHeader);

    // Calculate HMAC on raw bytes (Buffer) - Shopify calculates HMAC on raw request body
    const hash = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("base64");

    logger.debug("[ShopifyService] Calculated HMAC:", hash);
    logger.debug("[ShopifyService] Expected HMAC:  ", hmacHeader);
    logger.debug("[ShopifyService] Match:", hash === hmacHeader);

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(hmacHeader)
      );
      logger.debug("[ShopifyService] timingSafeEqual result:", isValid);
      return isValid;
    } catch (error) {
      logger.error("[ShopifyService] timingSafeEqual error:", error);
      return false;
    }
  }

  /**
   * List all registered webhooks
   */
  async listWebhooks(): Promise<ShopifyWebhook[]> {
    if (!this.validateCredentials()) {
      return [];
    }

    try {
      const url = `${this.baseApiUrl}/webhooks.json`;
      logger.debug(`[Shopify] Fetching webhooks from: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
      logger.debug(
        `[Shopify] Found ${data.webhooks?.length || 0} registered webhooks`
      );
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
    topic: string,
    address: string
  ): Promise<WebhookRegistrationResult> {
    if (!this.validateCredentials()) {
      return {
        success: false,
        error: "Missing Shopify credentials",
        message:
          "SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be configured",
      };
    }

    try {
      logger.info(
        `[Shopify] Registering webhook for topic: ${topic} at ${address}`
      );

      const existingWebhooks = await this.listWebhooks();
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

      const url = `${this.baseApiUrl}/webhooks.json`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
   * Use this as a fallback when webhook payload lacks customer data
   */
  async getOrder(orderId: number): Promise<any | null> {
    if (!this.validateCredentials()) {
      return null;
    }

    try {
      const url = `${this.baseApiUrl}/orders/${orderId}.json`;
      logger.debug(`[Shopify] Fetching order ${orderId} via API`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
    } catch (error) {
      logger.error("[Shopify] Error fetching order:", error);
      return null;
    }
  }

  /**
   * Fetch customer details by customer ID
   * Use this to get customer email/name when Protected Customer Data Access restricts webhook payloads
   */
  async getCustomer(customerId: number): Promise<any | null> {
    if (!this.validateCredentials()) {
      return null;
    }

    try {
      const url = `${this.baseApiUrl}/customers/${customerId}.json`;
      logger.debug(`[Shopify] Fetching customer ${customerId} via API`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
    } catch (error) {
      logger.error("[Shopify] Error fetching customer:", error);
      return null;
    }
  }

  /**
   * Delete a webhook by ID
   */
  async deleteWebhook(webhookId: number): Promise<boolean> {
    if (!this.validateCredentials()) {
      return false;
    }

    try {
      const url = `${this.baseApiUrl}/webhooks/${webhookId}.json`;
      logger.info(`[Shopify] Deleting webhook ID: ${webhookId}`);

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
   * Register the orders/create webhook
   * Uses APP_URL environment variable for local development or production
   */
  async registerOrdersWebhook(): Promise<WebhookRegistrationResult> {
    if (!process.env.APP_URL) {
      return {
        success: false,
        error: "APP_URL not configured",
        message:
          "APP_URL environment variable must be set. For local development, use a tunneling service like ngrok or cloudflared and set APP_URL to your public URL.",
      };
    }

    // Use APP_URL for local development or custom production URLs
    const baseUrl = process.env.APP_URL.replace(/\/$/, ""); // Remove trailing slash
    const webhookUrl = `${baseUrl}/api/webhooks/shopify/orders/create`;

    logger.info(
      `[Shopify] Registering orders/create webhook to: ${webhookUrl}`
    );
    return this.registerWebhook("orders/create", webhookUrl);
  }

  /**
   * Tag an order in Shopify as a duplicate
   */
  async tagOrder(orderId: string, tags: string[]): Promise<void> {
    if (!this.shopDomain || !this.accessToken) {
      logger.warn(
        "Shopify credentials not configured, skipping order tagging"
      );
      return;
    }

    const url = `https://${this.shopDomain}/admin/api/2024-01/orders/${orderId}.json`;

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
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
}

export const shopifyService = new ShopifyService();
