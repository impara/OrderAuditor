import crypto from "crypto";

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
  private apiVersion: string = "2024-01";

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
      console.error("Shopify credentials not configured");
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
      console.warn("[ShopifyService] SHOPIFY_WEBHOOK_SECRET not configured");
      return false;
    }

    console.log("[ShopifyService] Verifying webhook HMAC");
    console.log(
      "[ShopifyService] Secret configured:",
      this.webhookSecret.substring(0, 10) + "..."
    );
    console.log(
      "[ShopifyService] Body type:",
      typeof body,
      "isBuffer:",
      Buffer.isBuffer(body)
    );
    console.log("[ShopifyService] Body length:", body.length);
    console.log("[ShopifyService] HMAC header received:", hmacHeader);

    // Calculate HMAC on raw bytes (Buffer) - Shopify calculates HMAC on raw request body
    const hash = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("base64");

    console.log("[ShopifyService] Calculated HMAC:", hash);
    console.log("[ShopifyService] Expected HMAC:  ", hmacHeader);
    console.log("[ShopifyService] Match:", hash === hmacHeader);

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(hmacHeader)
      );
      console.log("[ShopifyService] timingSafeEqual result:", isValid);
      return isValid;
    } catch (error) {
      console.error("[ShopifyService] timingSafeEqual error:", error);
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
      console.log(`[Shopify] Fetching webhooks from: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[Shopify] Failed to list webhooks: ${response.status} ${response.statusText}`,
          errorText
        );
        throw new Error(
          `Shopify API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log(
        `[Shopify] Found ${data.webhooks?.length || 0} registered webhooks`
      );
      return data.webhooks || [];
    } catch (error) {
      console.error("[Shopify] Error listing webhooks:", error);
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
      console.log(
        `[Shopify] Registering webhook for topic: ${topic} at ${address}`
      );

      const existingWebhooks = await this.listWebhooks();
      const duplicate = existingWebhooks.find(
        (wh) => wh.topic === topic && wh.address === address
      );

      if (duplicate) {
        console.log(`[Shopify] Webhook already exists (ID: ${duplicate.id})`);
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
        console.error(
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
      console.log(
        `[Shopify] Successfully registered webhook (ID: ${data.webhook.id})`
      );

      return {
        success: true,
        webhook: data.webhook,
        message: "Webhook successfully registered",
      };
    } catch (error) {
      console.error("[Shopify] Error registering webhook:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to register webhook due to an error",
      };
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
      console.log(`[Shopify] Deleting webhook ID: ${webhookId}`);

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[Shopify] Failed to delete webhook: ${response.status}`,
          errorText
        );
        return false;
      }

      console.log(`[Shopify] Successfully deleted webhook ID: ${webhookId}`);
      return true;
    } catch (error) {
      console.error("[Shopify] Error deleting webhook:", error);
      return false;
    }
  }

  /**
   * Register the orders/create webhook
   * Uses APP_URL environment variable for local development or production
   * Falls back to REPLIT_DOMAINS for backward compatibility (if still using Replit)
   */
  async registerOrdersWebhook(): Promise<WebhookRegistrationResult> {
    let webhookUrl: string;

    if (process.env.APP_URL) {
      // Use APP_URL for local development or custom production URLs
      const baseUrl = process.env.APP_URL.replace(/\/$/, ""); // Remove trailing slash
      webhookUrl = `${baseUrl}/api/webhooks/shopify/orders/create`;
    } else if (process.env.REPLIT_DOMAINS) {
      // Fallback to Replit domains for backward compatibility
      webhookUrl = `https://${
        process.env.REPLIT_DOMAINS.split(",")[0]
      }/api/webhooks/shopify/orders/create`;
    } else {
      // No URL configured - return error
      return {
        success: false,
        error: "APP_URL not configured",
        message:
          "APP_URL environment variable must be set. For local development, use a tunneling service like ngrok and set APP_URL to your public URL.",
      };
    }

    console.log(
      `[Shopify] Registering orders/create webhook to: ${webhookUrl}`
    );
    return this.registerWebhook("orders/create", webhookUrl);
  }

  /**
   * Tag an order in Shopify as a duplicate
   */
  async tagOrder(orderId: string, tags: string[]): Promise<void> {
    if (!this.shopDomain || !this.accessToken) {
      console.warn(
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
      console.error("Failed to tag order in Shopify:", error);
      throw error;
    }
  }
}

export const shopifyService = new ShopifyService();
