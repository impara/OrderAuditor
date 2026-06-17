
import { logger } from "../utils/logger";
import { shopifyService } from "./shopify.service";
import { duplicateDetectionService } from "./duplicate-detection.service";
import { notificationService } from "./notification.service";
import { subscriptionService } from "./subscription.service";
import { storage } from "../storage";
import { getOfflineAccessToken } from "../shopify-auth";

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

      // 1.5 Check if order already exists. This is the primary idempotency guard.
      const existingOrder = await storage.getOrderByShopifyId(shopDomain, orderId.toString());
      if (existingOrder) {
        logger.info(`[WebhookProcessor] Order ${orderId} already exists in database. Marking delivery processed.`);
        if (existingOrder.isFlagged) {
          try {
            await shopifyService.tagOrder(shopDomain, accessToken, orderId.toString(), [
              "Merge_Review_Candidate",
            ]);
            logger.info(`[WebhookProcessor] Ensured tag for existing flagged order ${orderId}`);
          } catch (error) {
            logger.error(`[WebhookProcessor] Failed to ensure tag for existing flagged order ${orderId}:`, error);
          }
        }
        await recordProcessedDelivery();
        return;
      }

      // 1.6 Check Subscription Quota
      const quota = await subscriptionService.checkQuota(shopDomain);
      if (!quota.allowed) {
        if (
          quota.subscription.orderLimit !== -1 &&
          quota.subscription.monthlyOrderCount >= quota.subscription.orderLimit
        ) {
          try {
            await notificationService.sendQuotaExceededNotification(
              shopDomain,
              quota.subscription
            );
          } catch (error) {
            logger.warn(
              `[WebhookProcessor] Failed to send quota exceeded notification for ${shopDomain}:`,
              error
            );
          }
        }

        logger.info(`[WebhookProcessor] Quota exceeded for shop ${shopDomain}: ${quota.reason}. Skipping processing.`);
        await recordProcessedDelivery();
        return;
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

      const mappedOrder: any = {
        shopDomain,
        shopifyOrderId: orderId.toString(),
        orderNumber: shopifyOrder.order_number?.toString() || shopifyOrder.name || shopifyOrder.id.toString(),
        customerEmail: shopifyOrder.email || shopifyOrder.contact_email,
        customerName: shopifyOrder.customer
          ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim()
          : "Unknown",
        customerPhone: shopifyOrder.phone || shopifyOrder.customer?.phone || shopifyOrder.billing_address?.phone || shopifyOrder.shipping_address?.phone,
        shippingAddress: shopifyOrder.shipping_address,
        lineItems: shopifyOrder.line_items,
        totalPrice: shopifyOrder.total_price || "0.00",
        currency: shopifyOrder.currency || "USD",
        createdAt: new Date(shopifyOrder.created_at || new Date()),
        isFlagged: false
      };

      logger.debug(`[WebhookProcessor] Mapped order - customerPhone: ${mappedOrder.customerPhone || 'null'}, lineItems: ${mappedOrder.lineItems?.length || 0} items`);


      // 3. Duplicate Detection
      logger.info(`[WebhookProcessor] checking for duplicates for order ${orderId}`);
      const detectionResult = await duplicateDetectionService.findDuplicates(
        mappedOrder,
        shopDomain
      );

      // 4. Handle Result
      if (detectionResult) {
        logger.info(
          `[WebhookProcessor] 🚨 Duplicate detected for order ${orderId}. Score: ${detectionResult.confidence}`
        );

        // Tag the order
        try {
          await shopifyService.tagOrder(shopDomain, accessToken, orderId.toString(), [
            "Merge_Review_Candidate",
          ]);
          logger.info(`[WebhookProcessor] Tagged order ${orderId}`);
        } catch (error) {
          logger.error(`[WebhookProcessor] Failed to tag order ${orderId}:`, error);
          // Don't fail the job just because tagging failed, but log it
        }

        // Send notification
        try {
            // Need to get settings to pass to notification service because it requires them
            // In the original code (notificationService.ts), it checks settings internally only if provided
            // But here sendNotifications requires settings object.
            // Let's fetch settings first
            const settings = await storage.getSettings(shopDomain);
            if (settings) {
                const notificationSent = await notificationService.sendNotifications(shopDomain, settings, {
                    order: {
                        ...shopifyOrder,
                        orderNumber: shopifyOrder.order_number?.toString() || shopifyOrder.id.toString(),
                        createdAt: new Date(shopifyOrder.created_at),
                        currency: shopifyOrder.currency,
                        totalPrice: shopifyOrder.total_price,
                        customerName: mappedOrder.customerName,
                        customerEmail: mappedOrder.customerEmail || "",
                        shopifyOrderId: shopifyOrder.id.toString()
                    } as any, 
                    duplicateOf: detectionResult.order,
                    confidence: detectionResult.confidence,
                    matchReason: detectionResult.matchReason
                });
                if (notificationSent) {
                  logger.info(`[WebhookProcessor] Sent notification for order ${orderId}`);
                }
            }
        } catch (error) {
          logger.error(`[WebhookProcessor] Failed to send notification for order ${orderId}:`, error);
        }

        // Increment duplicate count and check for quota exceeded notification
        try {
          const updatedSubscription = await subscriptionService.recordOrder(shopDomain);
          logger.debug(`[WebhookProcessor] Updated duplicate count for ${shopDomain}: ${updatedSubscription.monthlyOrderCount}/${updatedSubscription.orderLimit}`);
          
          // Check if limit just reached (and hasn't been notified yet)
          if (updatedSubscription.orderLimit !== -1 && 
              updatedSubscription.monthlyOrderCount >= updatedSubscription.orderLimit) {
            await notificationService.sendQuotaExceededNotification(shopDomain, updatedSubscription);
          }
        } catch (error) {
          logger.warn(`[WebhookProcessor] Failed to update duplicate count:`, error);
        }
      }

      // 5. Save Order to Database
      // We save it regardless of duplicate status so future orders can be checked against it
      try {
        const orderToSave = {
            ...mappedOrder,
            isFlagged: !!detectionResult,
            matchConfidence: detectionResult ? Math.round(detectionResult.confidence) : 0,
            matchReason: detectionResult?.matchReason,
            duplicateOfOrderId: detectionResult?.order?.id,
            flaggedAt: detectionResult ? new Date() : null,
        };

        await storage.createOrder(orderToSave);
        logger.info(`[WebhookProcessor] Saved order ${orderId} to database`);
      } catch (error) {
        logger.error(`[WebhookProcessor] Failed to save order ${orderId} to database:`, error);
        // If it's a unique constraint error (already exists), we shouldn't fail
        if (String(error).includes("unique-constraint") || String(error).includes("duplicate key")) {
            logger.warn(`[WebhookProcessor] Order ${orderId} already exists in DB.`);
            await recordProcessedDelivery();
            return;
        } else {
             throw error; // Retry for db connection issues
        }
      }

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
