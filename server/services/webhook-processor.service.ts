
import { logger } from "../utils/logger";
import { shopifyService } from "./shopify.service";
import { storage } from "../storage";
import { getOfflineAccessToken } from "../shopify-auth";
import { mapShopifyOrder } from "./order-mapper.service";
import { processOrder } from "./order-processing.service";

interface OrderCreateJobData {
  shopDomain: string;
  payload: any;
  deliveryId: string;
  accessToken?: string;
  webhookTopic: string;
}

export function buildOrderCreateDeliveryId(
  shopDomain: string,
  orderId: string | number,
  deliveryIdHeader?: string | null
): string {
  const trimmedDeliveryId = deliveryIdHeader?.trim();
  if (trimmedDeliveryId) {
    return trimmedDeliveryId;
  }

  return buildOrderCreateJobKey(shopDomain, orderId);
}

export function buildOrderCreateJobKey(
  shopDomain: string,
  orderId: string | number
): string {
  return `orders/create:${shopDomain}:${orderId}`;
}

export class WebhookProcessorService {
  private static instance: WebhookProcessorService;

  private constructor() {}

  public static getInstance(): WebhookProcessorService {
    if (!WebhookProcessorService.instance) {
      WebhookProcessorService.instance = new WebhookProcessorService();
    }
    return WebhookProcessorService.instance;
  }

  /**
   * Process an order creation webhook
   * Logic extracted from previous synchronous handler
   */
  public async processOrderCreate(data: OrderCreateJobData): Promise<void> {
    const { shopDomain, payload: shopifyOrder, deliveryId } = data;
    const orderId = shopifyOrder.id;
    const webhookTopic = data.webhookTopic || "orders/create";
    const deliveryRecord = {
      shopDomain,
      deliveryId,
      topic: webhookTopic,
    };

    const recordProcessedDelivery = async () => {
      if (!deliveryId) {
        return;
      }

      await storage.markWebhookDeliveryProcessed(deliveryRecord);
    };

    logger.info(`[WebhookProcessor] Processing order ${orderId} for shop ${shopDomain}`);

    try {
      if (deliveryId) {
        await storage.markWebhookDeliveryProcessing(deliveryRecord);
      }

      // 1. Get a fresh Access Token.
      // For expiring offline tokens we must resolve (and possibly refresh) the
      // token at processing time: the token captured when the job was enqueued
      // may have expired before the worker picks it up.
      //
      // We deliberately do NOT fall back to the token captured at enqueue time.
      // If the offline token is expired and cannot be refreshed (or the session
      // is missing), we throw so pg-boss retries the job rather than calling the
      // Admin API with a token we already know is invalid.
      let accessToken: string | undefined;
      try {
        accessToken = (await getOfflineAccessToken(shopDomain)) ?? undefined;
      } catch (error) {
        logger.warn(
          `[WebhookProcessor] Failed to load/refresh session for ${shopDomain}:`,
          error
        );
      }

      if (!accessToken) {
        throw new Error(`[WebhookProcessor] No access token available for ${shopDomain}. Retrying processing.`);
      }

      // 2. Enhance Customer Data (if needed)
      // Note: In the synchronous version we did this before duplicate check
      // We'll keep it here to ensure we have the best data for matching
      
      // Check if we need to fetch order or customer details via API if email is missing
      if (accessToken && (!shopifyOrder.email && !shopifyOrder.contact_email)) {
        logger.info(`[WebhookProcessor] Email missing for order ${orderId}, attempting to fetch...`);
        try {
          const fetchedOrder = await shopifyService.getOrder(shopDomain, accessToken, orderId);
          if (fetchedOrder && (fetchedOrder.email || fetchedOrder.contact_email)) {
            shopifyOrder.email = fetchedOrder.email || shopifyOrder.email;
            shopifyOrder.contact_email = fetchedOrder.contact_email || shopifyOrder.contact_email;
            logger.info(`[WebhookProcessor] Fetched email for order ${orderId}`);
          }
        } catch (error) {
          logger.warn(`[WebhookProcessor] Failed to fetch order details:`, error);
        }
      }

      if (accessToken && shopifyOrder.customer?.id && !shopifyOrder.customer?.email && !shopifyOrder.email && !shopifyOrder.contact_email) {
         logger.info(`[WebhookProcessor] Still no email, fetching customer for order ${orderId}...`);
         try {
           const apiCustomer = await shopifyService.getCustomer(shopDomain, accessToken, shopifyOrder.customer.id);
           if (apiCustomer && apiCustomer.email) {
             shopifyOrder.customer = apiCustomer;
             logger.info(`[WebhookProcessor] Fetched customer details for order ${orderId}`);
           }
         } catch (error) {
           logger.warn(`[WebhookProcessor] Failed to fetch customer details:`, error);
         }
      }



      // 2.5 Map Shopify payload to Internal Order Model
      // Critical for DuplicateDetectionService which expects 'customerEmail' not 'email'
      
      // Debug: Log what we're extracting from Shopify payload
      logger.debug(`[WebhookProcessor] Shopify payload inspection:
        - phone field: ${shopifyOrder.phone || 'missing'}
        - customer.phone: ${shopifyOrder.customer?.phone || 'missing'}
        - billing_address.phone: ${shopifyOrder.billing_address?.phone || 'missing'}
        - shipping_address.phone: ${shopifyOrder.shipping_address?.phone || 'missing'}
        - line_items count: ${shopifyOrder.line_items?.length || 0}
        - line_items exists: ${!!shopifyOrder.line_items}
      `);

      const mappedOrder = mapShopifyOrder(shopDomain, shopifyOrder);

      logger.debug(`[WebhookProcessor] Mapped order - customerPhone: ${mappedOrder.customerPhone || 'null'}, lineItems: ${mappedOrder.lineItems?.length || 0} items`);


      await processOrder(mappedOrder, accessToken, { mode: "live" });
      logger.info(`[WebhookProcessor] Processed order ${orderId}`);

      await recordProcessedDelivery();

    } catch (error) {
      if (deliveryId) {
        try {
          await storage.markWebhookDeliveryFailed(deliveryRecord, error);
        } catch (deliveryError) {
          logger.error(
            `[WebhookProcessor] Failed to mark delivery ${deliveryId} as failed:`,
            deliveryError
          );
        }
      }
      logger.error(`[WebhookProcessor] Critical error processing order ${orderId}:`, error);
      throw error;
    }
  }
}

export const webhookProcessor = WebhookProcessorService.getInstance();
