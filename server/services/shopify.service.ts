import crypto from "crypto";

export class ShopifyService {
  private shopDomain: string;
  private accessToken: string;
  private webhookSecret: string;

  constructor() {
    this.shopDomain = process.env.SHOPIFY_SHOP_DOMAIN || "";
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN || "";
    this.webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  }

  /**
   * Verify Shopify webhook HMAC signature
   */
  verifyWebhook(body: string, hmacHeader: string): boolean {
    if (!this.webhookSecret) {
      console.warn("SHOPIFY_WEBHOOK_SECRET not configured");
      return false;
    }

    const hash = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(body, "utf8")
      .digest("base64");

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmacHeader)
    );
  }

  /**
   * Tag an order in Shopify as a duplicate
   */
  async tagOrder(orderId: string, tags: string[]): Promise<void> {
    if (!this.shopDomain || !this.accessToken) {
      console.warn("Shopify credentials not configured, skipping order tagging");
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
