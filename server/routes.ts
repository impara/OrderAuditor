import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { duplicateDetectionService } from "./services/duplicate-detection.service";
import { shopifyService } from "./services/shopify.service";
import { notificationService } from "./services/notification.service";
import { subscriptionService } from "./services/subscription.service";
import { shopifyBillingService } from "./services/shopify-billing.service";
import {
  insertOrderSchema,
  updateDetectionSettingsSchema,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { logger } from "./utils/logger";

/**
 * Validate returnUrl to prevent open redirect attacks
 * Only allows relative paths or URLs from the application's own domain
 */
function validateReturnUrl(returnUrl: string): string {
  const appUrl = process.env.APP_URL || "http://localhost:5000";

  // If it's a relative path, it's safe
  if (returnUrl.startsWith("/")) {
    return returnUrl;
  }

  try {
    const url = new URL(returnUrl);
    const appUrlObj = new URL(appUrl);

    // Only allow URLs from the same origin (same protocol, hostname, and port)
    if (
      url.protocol === appUrlObj.protocol &&
      url.hostname === appUrlObj.hostname &&
      url.port === appUrlObj.port
    ) {
      return returnUrl;
    }

    // If validation fails, return a safe default
    logger.warn(`[Security] Invalid returnUrl rejected: ${returnUrl}`);
    return `${appUrl}/subscription?upgrade=success`;
  } catch (error) {
    // If URL parsing fails, return a safe default
    logger.warn(`[Security] Invalid returnUrl format rejected: ${returnUrl}`);
    return `${appUrl}/subscription?upgrade=success`;
  }
}

import { auth, authCallback, verifyRequest, shopify } from "./shopify-auth";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(
    express.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  // Auth Routes
  app.get("/api/auth", auth);
  app.get("/api/auth/callback", authCallback);

  // Health Check
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Webhook routes (bypass auth middleware)
  // ... (webhooks are registered below)

  // Protected API Routes
  // Apply middleware to all /api routes EXCEPT auth and webhooks
  app.use("/api", (req, res, next) => {
    const path = req.path;
    if (
      path.startsWith("/auth") ||
      path.startsWith("/webhooks/shopify") ||
      path === "/health"
    ) {
      next();
    } else {
      verifyRequest(req, res, next);
    }
  });

  app.get("/api/dashboard/stats", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const stats = await storage.getDashboardStats(shop);
      res.json(stats);
    } catch (error) {
      logger.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/orders/flagged", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const orders = await storage.getFlaggedOrders(shop);
      res.json(orders);
    } catch (error) {
      logger.error("Error fetching flagged orders:", error);
      res.status(500).json({ error: "Failed to fetch flagged orders" });
    }
  });

  app.post(
    "/api/orders/:orderId/dismiss",
    async (req: Request, res: Response) => {
      try {
        const { shop, accessToken } = res.locals.shopify;
        const { orderId } = req.params;

        // Get the order first to check if it exists and get Shopify order ID
        const order = await storage.getOrder(shop, orderId);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        if (!order.isFlagged) {
          return res
            .status(400)
            .json({ error: "Order is not currently flagged" });
        }

        // Dismiss the order (sets isFlagged: false, resolvedAt, resolvedBy)
        const dismissedOrder = await storage.dismissOrder(shop, orderId);

        // Remove the tag from Shopify
        try {
          await shopifyService.removeOrderTag(
            shop,
            accessToken,
            order.shopifyOrderId,
            "Merge_Review_Candidate"
          );
        } catch (error) {
          logger.error(
            "Failed to remove tag from Shopify, but order was dismissed:",
            error
          );
          // Continue even if tag removal fails - order is already dismissed in our system
        }

        // Log the dismissal action
        await storage.createAuditLog({
          shopDomain: shop,
          orderId: dismissedOrder.id,
          action: "dismissed",
          details: {
            resolvedBy: "manual_dashboard",
            resolvedAt: dismissedOrder.resolvedAt,
          },
        });

        res.json({
          success: true,
          order: dismissedOrder,
          message: "Order dismissed successfully",
        });
      } catch (error) {
        logger.error("Error dismissing order:", error);
        res.status(500).json({
          error: "Failed to dismiss order",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  app.get("/api/settings", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      let settings = await storage.getSettings(shop);
      if (!settings) {
        settings = await storage.initializeSettings(shop);
      }
      res.json(settings);
    } catch (error) {
      logger.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", async (req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const validatedData = updateDetectionSettingsSchema.parse(req.body);
      const settings = await storage.updateSettings(shop, validatedData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(400).json({ error: "Invalid settings data" });
    }
  });

  app.get("/api/webhooks/status", async (_req: Request, res: Response) => {
    try {
      const { shop, accessToken } = res.locals.shopify;
      logger.debug("[API] Checking webhook registration status");
      logger.debug(
        `[API] Shop: ${shop}, Access token available: ${!!accessToken}, Token length: ${
          accessToken?.length || 0
        }`
      );

      // Validate access token format before making API call
      if (!accessToken) {
        logger.error("[API] No access token available in session");
        return res.status(401).json({
          error: "No access token available",
          message:
            "The app session does not have a valid access token. Please reinstall the app.",
          shop: shop,
          requiresReinstall: true,
        });
      }

      // Check if token looks valid (Shopify tokens typically start with 'shpat_' or 'shpca_')
      if (
        !accessToken.startsWith("shpat_") &&
        !accessToken.startsWith("shpca_")
      ) {
        logger.warn(
          `[API] Access token has unexpected format. Prefix: ${accessToken.substring(
            0,
            10
          )}...`
        );
      }

      const webhooks = await shopifyService.listWebhooks(shop, accessToken);

      const ordersCreateWebhook = webhooks.find(
        (wh) => wh.topic === "orders/create"
      );
      const ordersUpdatedWebhook = webhooks.find(
        (wh) => wh.topic === "orders/updated"
      );
      const appUninstalledWebhook = webhooks.find(
        (wh) => wh.topic === "app/uninstalled"
      );

      res.json({
        registered: !!(
          ordersCreateWebhook &&
          ordersUpdatedWebhook &&
          appUninstalledWebhook
        ),
        webhooks: {
          ordersCreate: ordersCreateWebhook || null,
          ordersUpdated: ordersUpdatedWebhook || null,
          appUninstalled: appUninstalledWebhook || null,
        },
        totalWebhooks: webhooks.length,
        allWebhooks: webhooks,
      });
    } catch (error) {
      logger.error("[API] Error checking webhook status:", error);

      // Check if it's an authentication error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("authentication failed");

      res.status(isAuthError ? 401 : 500).json({
        error: "Failed to check webhook status",
        details: errorMessage,
        requiresReinstall: isAuthError,
        message: isAuthError
          ? "The access token is invalid or expired. Please reinstall the app to refresh the authentication."
          : "An error occurred while checking webhook status.",
      });
    }
  });

  app.post("/api/webhooks/register", async (_req: Request, res: Response) => {
    try {
      const { shop, accessToken } = res.locals.shopify;
      logger.info("[API] Webhook registration requested");

      if (!process.env.APP_URL) {
        return res.status(500).json({ error: "APP_URL not configured" });
      }

      const baseUrl = process.env.APP_URL.replace(/\/$/, "");

      const ordersCreateResult = await shopifyService.registerWebhookWithRetry(
        shop,
        accessToken,
        "orders/create",
        `${baseUrl}/api/webhooks/shopify/orders/create`
      );

      const ordersUpdatedResult = await shopifyService.registerWebhookWithRetry(
        shop,
        accessToken,
        "orders/updated",
        `${baseUrl}/api/webhooks/shopify/orders/updated`
      );

      const appUninstalledResult =
        await shopifyService.registerWebhookWithRetry(
          shop,
          accessToken,
          "app/uninstalled",
          `${baseUrl}/api/webhooks/shopify/app/uninstalled`
        );

      const allSuccess =
        ordersCreateResult.success &&
        ordersUpdatedResult.success &&
        appUninstalledResult.success;

      res.json({
        success: allSuccess,
        webhooks: {
          ordersCreate: ordersCreateResult,
          ordersUpdated: ordersUpdatedResult,
          appUninstalled: appUninstalledResult,
        },
        message: allSuccess
          ? "All webhooks registered successfully"
          : "Some webhooks failed to register",
      });
    } catch (error) {
      logger.error("[API] Error registering webhooks:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to register webhooks",
      });
    }
  });

  app.post("/api/webhooks/test", async (req: any, res: Response) => {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const rawBodyStr = Buffer.isBuffer(rawBody)
      ? rawBody.toString("utf8")
      : rawBody;

    res.json({
      headers: {
        hmac: hmacHeader,
        contentType: req.get("Content-Type"),
      },
      body: {
        rawBodyAvailable: !!req.rawBody,
        rawBodyIsBuffer: Buffer.isBuffer(rawBody),
        rawBodyLength: rawBodyStr.length,
        rawBodyPreview: rawBodyStr.substring(0, 100),
        parsedBody: req.body,
      },
      verification: {
        secretConfigured: !!process.env.SHOPIFY_WEBHOOK_SECRET,
        secretLength: process.env.SHOPIFY_WEBHOOK_SECRET?.length || 0,
        wouldVerify: hmacHeader
          ? shopifyService.verifyWebhook(rawBody, hmacHeader)
          : false,
      },
    });
  });

  app.post(
    "/api/webhooks/shopify/orders/create",
    async (req: any, res: Response) => {
      try {
        // With express.raw middleware, req.body is a Buffer
        const rawBody: Buffer = req.body;

        logger.debug(
          `[Webhook] Received webhook, body size: ${rawBody.length} bytes`
        );
        logger.debug(`[Webhook] Body is Buffer: ${Buffer.isBuffer(rawBody)}`);
        logger.debug(
          `[Webhook] Body preview: ${rawBody
            .toString("utf8")
            .substring(0, 50)}...`
        );

        // Validate webhook using custom service
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const topicHeader = req.get("X-Shopify-Topic");
        const shopHeader = req.get("X-Shopify-Shop-Domain");
        const deliveryIdHeader =
          req.get("X-Shopify-Delivery-Id") ||
          req.get("X-Shopify-Webhook-Id") ||
          "";

        if (!hmacHeader) {
          logger.warn("[Webhook] ❌ Missing HMAC header");
          return res.status(401).json({ error: "Missing HMAC header" });
        }

        const isValid = shopifyService.verifyWebhook(rawBody, hmacHeader);

        if (!isValid) {
          logger.warn(`[Webhook] ❌ Invalid webhook signature.`);
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        const shopDomain = shopHeader;
        const topic = topicHeader;

        if (!shopDomain) {
          logger.error("[Webhook] ❌ Missing shop domain header");
          return res.status(400).json({ error: "Missing shop domain" });
        }

        logger.debug(
          `[Webhook] ✅ Signature verified successfully! Shop: ${shopDomain}, Topic: ${
            topic || "unknown"
          }`
        );

        // Atomically check and record webhook delivery ID to prevent TOCTOU race conditions
        // This uses database-level atomicity: if insert succeeds, it's new; if it fails (conflict), it's duplicate
        if (deliveryIdHeader) {
          try {
            const isNew = await storage.tryRecordWebhookDelivery({
              shopDomain,
              deliveryId: deliveryIdHeader,
              topic: topic || "orders/create",
            });
            if (!isNew) {
              logger.info(
                `[Webhook] ⚠️ Duplicate webhook delivery detected (ID: ${deliveryIdHeader}). Skipping processing.`
              );
              return res.json({
                success: true,
                message: "Webhook already processed",
                duplicate: true,
              });
            }
            logger.debug(
              `[Webhook] Recorded delivery ID ${deliveryIdHeader} before processing`
            );
          } catch (error) {
            logger.error("Failed to record webhook delivery ID:", error);
            // If recording fails, we should still proceed but idempotency won't be guaranteed
          }
        }

        // Parse JSON after verification
        const shopifyOrder = JSON.parse(rawBody.toString("utf8"));

        // Log webhook payload structure for debugging
        logger.debug(
          `[Webhook] Order payload - ID: ${
            shopifyOrder.id
          }, Email in payload: ${!!shopifyOrder.email}, Contact email: ${!!shopifyOrder.contact_email}, Customer ID: ${
            shopifyOrder.customer?.id || "N/A"
          }, Customer email in payload: ${!!shopifyOrder.customer?.email}`
        );

        // Load session to get access token
        let accessToken = "";
        if (shopDomain) {
          const offlineSessionId = shopify.session.getOfflineId(shopDomain);
          const session = await shopify.config.sessionStorage.loadSession(
            offlineSessionId
          );
          if (session?.accessToken) {
            accessToken = session.accessToken;
          } else {
            logger.warn(
              `[Webhook] ⚠️ Could not load offline session for ${shopDomain}. API calls will fail.`
            );
          }
        }

        // Check if we need to fetch order or customer details via API
        let customerData = shopifyOrder.customer;
        let fetchedOrder = null;

        if (accessToken && shopDomain) {
          // First, try fetching the order via API to get email
          if (!shopifyOrder.email && !shopifyOrder.contact_email) {
            logger.warn(
              "[Webhook] ⚠️ Email not in webhook payload, attempting to fetch order via API..."
            );
            try {
              fetchedOrder = await shopifyService.getOrder(
                shopDomain,
                accessToken,
                shopifyOrder.id
              );
              if (
                fetchedOrder &&
                (fetchedOrder.email || fetchedOrder.contact_email)
              ) {
                logger.info(
                  `[Webhook] ✅ Successfully fetched order via API - Email: ${
                    fetchedOrder.email || fetchedOrder.contact_email
                  }`
                );
                Object.assign(shopifyOrder, {
                  email: fetchedOrder.email || shopifyOrder.email,
                  contact_email:
                    fetchedOrder.contact_email || shopifyOrder.contact_email,
                });
              } else {
                logger.warn(
                  `[Webhook] ⚠️ Order API fetch returned no email. Order data: ${JSON.stringify(
                    fetchedOrder
                      ? {
                          id: fetchedOrder.id,
                          hasEmail: !!fetchedOrder.email,
                          hasContactEmail: !!fetchedOrder.contact_email,
                        }
                      : null
                  )}`
                );
              }
            } catch (err) {
              logger.error("[Webhook] ❌ Order API fetch failed", err);
            }
          }

          // If we still don't have email and have a customer ID, try fetching customer
          if (
            shopifyOrder.customer?.id &&
            !shopifyOrder.customer?.email &&
            !shopifyOrder.email &&
            !shopifyOrder.contact_email
          ) {
            logger.warn(
              "[Webhook] ⚠️ Still no email found, attempting to fetch customer via API..."
            );
            try {
              const apiCustomer = await shopifyService.getCustomer(
                shopDomain,
                accessToken,
                shopifyOrder.customer.id
              );
              if (apiCustomer && apiCustomer.email) {
                logger.info(
                  `[Webhook] ✅ Successfully fetched customer via API - Email: ${
                    apiCustomer.email
                  }, Name: ${apiCustomer.first_name || ""} ${
                    apiCustomer.last_name || ""
                  }`
                );
                customerData = apiCustomer;
              } else {
                logger.warn(
                  `[Webhook] ⚠️ Customer API returned no email. Customer data: ${JSON.stringify(
                    apiCustomer
                      ? { id: apiCustomer.id, hasEmail: !!apiCustomer.email }
                      : null
                  )}`
                );
              }
            } catch (err) {
              logger.error("[Webhook] ❌ Customer API fetch failed", err);
            }
          }
        }

        // Use webhook order data
        const fullOrder = shopifyOrder;

        // Extract customer email
        const customerEmail =
          fullOrder.email ||
          fullOrder.contact_email ||
          fullOrder.customer?.email ||
          customerData?.email ||
          fullOrder.shipping_address?.email ||
          fullOrder.billing_address?.email ||
          customerData?.default_address?.email ||
          null;

        // Extract customer name
        const customerName = (() => {
          const firstName =
            fullOrder.first_name ||
            customerData?.first_name ||
            fullOrder.shipping_address?.first_name ||
            customerData?.default_address?.first_name ||
            fullOrder.billing_address?.first_name ||
            "";
          const lastName =
            fullOrder.last_name ||
            customerData?.last_name ||
            fullOrder.shipping_address?.last_name ||
            customerData?.default_address?.last_name ||
            fullOrder.billing_address?.last_name ||
            "";

          if (firstName && lastName) {
            return `${firstName} ${lastName}`;
          } else if (firstName) {
            return firstName;
          } else if (lastName) {
            return lastName;
          }

          if (customerData?.name) return customerData.name;
          if (fullOrder.shipping_address?.name)
            return fullOrder.shipping_address.name;
          if (customerData?.default_address?.name)
            return customerData.default_address.name;

          return null;
        })();

        // Extract customer phone
        const customerPhone =
          fullOrder.phone ||
          customerData?.phone ||
          fullOrder.shipping_address?.phone ||
          fullOrder.billing_address?.phone ||
          customerData?.default_address?.phone ||
          null;

        const orderData = {
          shopDomain: shopDomain || "unknown-shop", // Fallback if header missing (shouldn't happen)
          shopifyOrderId: fullOrder.id.toString(),
          orderNumber: fullOrder.order_number?.toString() || fullOrder.name,
          customerEmail: customerEmail || "unknown@example.com",
          customerName,
          customerPhone,
          shippingAddress: fullOrder.shipping_address
            ? {
                address1: fullOrder.shipping_address.address1,
                address2: fullOrder.shipping_address.address2,
                city: fullOrder.shipping_address.city,
                province: fullOrder.shipping_address.province,
                country: fullOrder.shipping_address.country,
                zip: fullOrder.shipping_address.zip,
              }
            : null,
          totalPrice: fullOrder.total_price || "0.00",
          currency: fullOrder.currency || "USD",
          createdAt: new Date(fullOrder.created_at),
        };

        const validatedOrder = insertOrderSchema.parse(orderData);

        // Check if order already exists
        const existingOrder = await storage.getOrderByShopifyId(
          shopDomain,
          validatedOrder.shopifyOrderId
        );
        if (existingOrder) {
          logger.info(
            `[Webhook] Order ${validatedOrder.shopifyOrderId} already exists, skipping duplicate processing`
          );
          // Record webhook delivery ID for idempotency before returning
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/create",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }
          return res.json({
            success: true,
            flagged: existingOrder.isFlagged,
            order: existingOrder,
            message: "Order already processed",
          });
        }

        // Check subscription quota
        if (shopDomain) {
          const quotaCheck = await subscriptionService.checkQuota(shopDomain);
          if (!quotaCheck.allowed) {
            logger.warn(
              `[Webhook] Quota exceeded for ${shopDomain}: ${quotaCheck.reason}`
            );
            // Record webhook delivery ID for idempotency before returning
            if (deliveryIdHeader) {
              try {
                await storage.recordWebhookDelivery({
                  shopDomain,
                  deliveryId: deliveryIdHeader,
                  topic: topic || "orders/create",
                });
              } catch (error) {
                logger.error("Failed to record webhook delivery ID:", error);
              }
            }
            return res.status(403).json({
              success: false,
              error: "QUOTA_EXCEEDED",
              message: quotaCheck.reason || "Monthly order limit reached",
              subscription: quotaCheck.subscription,
            });
          }
        }

        // Ensure detection settings are initialized
        let settings = await storage.getSettings(shopDomain);
        if (!settings) {
          settings = await storage.initializeSettings(shopDomain);
        }

        logger.debug(
          `[Webhook] Checking for duplicates - Email: ${validatedOrder.customerEmail}, Shop: ${shopDomain}`
        );
        const duplicateMatch = await duplicateDetectionService.findDuplicates(
          validatedOrder,
          shopDomain
        );

        if (duplicateMatch) {
          logger.info(
            `[Webhook] ✅ Duplicate detected! Match confidence: ${duplicateMatch.confidence}%, Reason: ${duplicateMatch.matchReason}`
          );
          const flaggedOrder = await storage.createOrder(validatedOrder);

          await storage.updateOrder(shopDomain, flaggedOrder.id, {
            isFlagged: true,
            flaggedAt: new Date(),
            duplicateOfOrderId: duplicateMatch.order.id,
            matchReason: duplicateMatch.matchReason,
            matchConfidence: duplicateMatch.confidence,
          });

          await storage.createAuditLog({
            shopDomain,
            orderId: flaggedOrder.id,
            action: "flagged",
            details: {
              duplicateOf: duplicateMatch.order.orderNumber,
              confidence: duplicateMatch.confidence,
              reason: duplicateMatch.matchReason,
            },
          });

          if (accessToken && shopDomain) {
            try {
              await shopifyService.tagOrder(
                shopDomain,
                accessToken,
                fullOrder.id.toString(),
                ["Merge_Review_Candidate"]
              );

              await storage.createAuditLog({
                shopDomain,
                orderId: flaggedOrder.id,
                action: "tagged",
                details: { tags: ["Merge_Review_Candidate"] },
              });
            } catch (error) {
              logger.error("Failed to tag order in Shopify:", error);
            }
          }

          // Send notifications if enabled
          try {
            const updatedOrder = await storage.getOrder(
              shopDomain,
              flaggedOrder.id
            );
            const duplicateOfOrder = await storage.getOrder(
              shopDomain,
              duplicateMatch.order.id
            );

            if (updatedOrder && duplicateOfOrder && shopDomain) {
              await notificationService.sendNotifications(
                shopDomain,
                settings,
                {
                  order: updatedOrder,
                  duplicateOf: duplicateOfOrder,
                  confidence: duplicateMatch.confidence,
                  matchReason: duplicateMatch.matchReason,
                }
              );
            }
          } catch (error) {
            logger.error("Failed to send notifications:", error);
          }

          // Record order for quota tracking
          if (shopDomain) {
            try {
              await subscriptionService.recordOrder(shopDomain);
            } catch (error) {
              logger.error("Failed to record order for quota:", error);
            }
          }

          const updatedOrder = await storage.getOrder(
            shopDomain,
            flaggedOrder.id
          );

          // Ensure delivery ID is recorded for idempotency (if header was present)
          // Note: If deliveryIdHeader was empty, we can't record anything, but the webhook was still processed
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/create",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }

          res.json({
            success: true,
            flagged: true,
            order: updatedOrder,
          });
        } else {
          logger.debug(
            `[Webhook] No duplicate match found for order ${validatedOrder.orderNumber}. Creating order without flag.`
          );
          const order = await storage.createOrder(validatedOrder);

          // Record order for quota tracking
          if (shopDomain) {
            try {
              await subscriptionService.recordOrder(shopDomain);
            } catch (error) {
              logger.error("Failed to record order for quota:", error);
            }
          }

          // Ensure delivery ID is recorded for idempotency (if header was present)
          // Note: If deliveryIdHeader was empty, we can't record anything, but the webhook was still processed
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/create",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }

          res.json({
            success: true,
            flagged: false,
            order,
          });
        }
      } catch (error) {
        logger.error("Error processing webhook:", error);
        res.status(500).json({ error: "Failed to process webhook" });
      }
    }
  );

  app.post(
    "/api/webhooks/shopify/orders/updated",
    async (req: any, res: Response) => {
      try {
        // With express.raw middleware, req.body is a Buffer
        const rawBody: Buffer = req.body;

        logger.debug(
          `[Webhook] Received orders/updated webhook, body size: ${rawBody.length} bytes`
        );
        logger.debug(`[Webhook] Body is Buffer: ${Buffer.isBuffer(rawBody)}`);
        logger.debug(
          `[Webhook] Body preview: ${rawBody
            .toString("utf8")
            .substring(0, 50)}...`
        );

        // Validate webhook using custom service
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const topicHeader = req.get("X-Shopify-Topic");
        const shopHeader = req.get("X-Shopify-Shop-Domain");
        const deliveryIdHeader =
          req.get("X-Shopify-Delivery-Id") ||
          req.get("X-Shopify-Webhook-Id") ||
          "";

        if (!hmacHeader) {
          logger.warn("[Webhook] ❌ Missing HMAC header");
          return res.status(401).json({ error: "Missing HMAC header" });
        }

        const isValid = shopifyService.verifyWebhook(rawBody, hmacHeader);

        if (!isValid) {
          logger.warn(`[Webhook] ❌ Invalid webhook signature.`);
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        const shopDomain = shopHeader;
        const topic = topicHeader;

        if (!shopDomain) {
          logger.error("[Webhook] ❌ Missing shop domain header");
          return res.status(400).json({ error: "Missing shop domain" });
        }

        logger.debug(
          `[Webhook] ✅ Signature verified successfully! Shop: ${shopDomain}, Topic: ${
            topic || "unknown"
          }`
        );

        // Atomically check and record webhook delivery ID to prevent TOCTOU race conditions
        // This uses database-level atomicity: if insert succeeds, it's new; if it fails (conflict), it's duplicate
        if (deliveryIdHeader) {
          try {
            const isNew = await storage.tryRecordWebhookDelivery({
              shopDomain,
              deliveryId: deliveryIdHeader,
              topic: topic || "orders/updated",
            });
            if (!isNew) {
              logger.info(
                `[Webhook] ⚠️ Duplicate webhook delivery detected (ID: ${deliveryIdHeader}). Skipping processing.`
              );
              return res.json({
                success: true,
                message: "Webhook already processed",
                duplicate: true,
              });
            }
            logger.debug(
              `[Webhook] Recorded delivery ID ${deliveryIdHeader} before processing`
            );
          } catch (error) {
            logger.error("Failed to record webhook delivery ID:", error);
            // If recording fails, we should still proceed but idempotency won't be guaranteed
          }
        }

        // Parse JSON after verification
        const shopifyOrder = JSON.parse(rawBody.toString("utf8"));

        // Check if order exists in our database
        const order = await storage.getOrderByShopifyId(
          shopDomain,
          shopifyOrder.id.toString()
        );

        if (!order) {
          logger.debug("[Webhook] Order not found in database, skipping");
          // Record webhook delivery ID for idempotency before returning
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/updated",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }
          return res.json({ success: true, message: "Order not tracked" });
        }

        // Only process if order is currently flagged
        if (!order.isFlagged) {
          logger.debug("[Webhook] Order is not flagged, skipping");
          // Record webhook delivery ID for idempotency before returning
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/updated",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }
          return res.json({ success: true, message: "Order not flagged" });
        }

        // Check if "Merge_Review_Candidate" tag was removed
        const currentTags = shopifyOrder.tags
          ? shopifyOrder.tags.split(", ").map((t: string) => t.trim())
          : [];
        const hasTag = currentTags.includes("Merge_Review_Candidate");

        if (hasTag) {
          logger.debug("[Webhook] Tag still present, no action needed");
          // Record webhook delivery ID for idempotency before returning
          if (deliveryIdHeader) {
            try {
              await storage.recordWebhookDelivery({
                shopDomain,
                deliveryId: deliveryIdHeader,
                topic: topic || "orders/updated",
              });
            } catch (error) {
              logger.error("Failed to record webhook delivery ID:", error);
            }
          }
          return res.json({ success: true, message: "Tag still present" });
        }

        // Tag was removed - resolve the order
        logger.info(
          `[Webhook] Tag removed from order ${order.id}, resolving order`
        );

        const resolvedOrder = await storage.resolveOrder(
          shopDomain,
          order.id,
          "shopify_tag_removed"
        );

        // Log the resolution action
        await storage.createAuditLog({
          shopDomain,
          orderId: resolvedOrder.id,
          action: "resolved",
          details: {
            resolvedBy: "shopify_tag_removed",
            resolvedAt: resolvedOrder.resolvedAt,
            shopifyOrderId: shopifyOrder.id,
          },
        });

        // Ensure delivery ID is recorded for idempotency (if header was present)
        // Note: If deliveryIdHeader was empty, we can't record anything, but the webhook was still processed
        if (deliveryIdHeader) {
          try {
            await storage.recordWebhookDelivery({
              shopDomain,
              deliveryId: deliveryIdHeader,
              topic: topic || "orders/updated",
            });
          } catch (error) {
            logger.error("Failed to record webhook delivery ID:", error);
          }
        }

        res.json({
          success: true,
          order: resolvedOrder,
          message: "Order resolved due to tag removal",
        });
      } catch (error) {
        logger.error("Error processing orders/updated webhook:", error);
        res.status(500).json({ error: "Failed to process webhook" });
      }
    }
  );

  app.post(
    "/api/webhooks/shopify/app/uninstalled",
    async (req: any, res: Response) => {
      try {
        // With express.raw middleware, req.body is a Buffer
        const rawBody: Buffer = req.body;

        logger.info(
          `[Webhook] Received app/uninstalled webhook, body size: ${rawBody.length} bytes`
        );

        // Validate webhook using custom service
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const topicHeader = req.get("X-Shopify-Topic");
        const shopHeader = req.get("X-Shopify-Shop-Domain");
        const deliveryIdHeader =
          req.get("X-Shopify-Delivery-Id") ||
          req.get("X-Shopify-Webhook-Id") ||
          "";

        if (!hmacHeader) {
          logger.warn("[Webhook] ❌ Missing HMAC header");
          return res.status(401).json({ error: "Missing HMAC header" });
        }

        const isValid = shopifyService.verifyWebhook(rawBody, hmacHeader);

        if (!isValid) {
          logger.warn(`[Webhook] ❌ Invalid webhook signature.`);
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        const shopDomain = shopHeader;
        const topic = topicHeader;

        if (!shopDomain) {
          logger.error("[Webhook] ❌ Missing shop domain header");
          return res.status(400).json({ error: "Missing shop domain" });
        }

        logger.info(
          `[Webhook] ✅ Signature verified successfully! Shop: ${shopDomain}, Topic: ${
            topic || "unknown"
          }`
        );

        // Atomically check and record webhook delivery ID to prevent TOCTOU race conditions
        // This uses database-level atomicity: if insert succeeds, it's new; if it fails (conflict), it's duplicate
        // Also preserves idempotency by recording before deleting shop data
        const hasDeliveryId =
          deliveryIdHeader && deliveryIdHeader.trim().length > 0;

        if (!hasDeliveryId) {
          logger.warn(
            `[Webhook] ⚠️ Missing delivery ID headers (X-Shopify-Delivery-Id and X-Shopify-Webhook-Id). Idempotency protection will be limited for this webhook.`
          );
        }

        if (hasDeliveryId) {
          try {
            const isNew = await storage.tryRecordWebhookDelivery({
              shopDomain,
              deliveryId: deliveryIdHeader,
              topic: topic || "app/uninstalled",
            });
            if (!isNew) {
              logger.info(
                `[Webhook] ⚠️ Duplicate app/uninstalled webhook detected (ID: ${deliveryIdHeader}). Skipping processing.`
              );
              return res.json({
                success: true,
                message: "Webhook already processed",
                duplicate: true,
              });
            }
            logger.debug(
              `[Webhook] Recorded delivery ID ${deliveryIdHeader} before cleanup`
            );
          } catch (error) {
            logger.error("Failed to record webhook delivery ID:", error);
            // If recording fails, we should still proceed with cleanup
            // but idempotency won't be guaranteed for this delivery
            // Note: cleanup is idempotent, so retries won't cause issues
          }
        }

        // Parse JSON after verification
        const webhookData = JSON.parse(rawBody.toString("utf8"));
        logger.info(
          `[Webhook] App uninstalled for shop: ${shopDomain}. Cleaning up shop data...`
        );

        // Delete all shop data (excluding the current delivery ID to preserve idempotency)
        // Only pass excludeDeliveryId if it's a non-empty string to avoid deleting all delivery records
        // If this fails, we must return an error - the operation didn't complete successfully
        await storage.deleteShopData(
          shopDomain,
          hasDeliveryId ? deliveryIdHeader : undefined
        );
        logger.info(
          `[Webhook] ✅ Successfully cleaned up all data for shop: ${shopDomain}`
        );

        res.json({
          success: true,
          message: "App uninstalled and shop data cleaned up",
        });
      } catch (error) {
        logger.error("Error processing app/uninstalled webhook:", error);
        res.status(500).json({ error: "Failed to process webhook" });
      }
    }
  );

  // Subscription endpoints
  app.get("/api/subscription", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      logger.info(`[Subscription] Fetching subscription for shop: ${shop}`);
      const subscription = await subscriptionService.getSubscription(shop);
      logger.info(`[Subscription] Retrieved subscription:`, subscription);
      res.json(subscription);
    } catch (error) {
      logger.error("Error fetching subscription:", error);
      logger.error(
        "Stack trace:",
        error instanceof Error ? error.stack : "No stack trace"
      );
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });

  app.post("/api/subscription/upgrade", async (req: Request, res: Response) => {
    try {
      const { shop, accessToken } = res.locals.shopify;
      const defaultReturnUrl = `${
        process.env.APP_URL || "http://localhost:5000"
      }/subscription?upgrade=success`;
      const requestedReturnUrl = req.body.returnUrl || defaultReturnUrl;

      // Validate returnUrl to prevent open redirect attacks
      const returnUrl = validateReturnUrl(requestedReturnUrl);

      const charge = await shopifyBillingService.createRecurringCharge(
        shop,
        accessToken,
        returnUrl
      );

      if (!charge) {
        return res
          .status(500)
          .json({ error: "Failed to create billing charge" });
      }

      res.json({
        success: true,
        charge,
        confirmationUrl: charge.confirmation_url,
      });
    } catch (error) {
      logger.error("Error creating upgrade charge:", error);
      res.status(500).json({ error: "Failed to create upgrade charge" });
    }
  });

  app.post(
    "/api/subscription/activate",
    async (req: Request, res: Response) => {
      try {
        const { shop, accessToken } = res.locals.shopify;
        const { chargeId } = req.body;
        if (!chargeId) {
          return res.status(400).json({ error: "chargeId is required" });
        }

        const success = await shopifyBillingService.activateCharge(
          shop,
          accessToken,
          chargeId
        );
        if (!success) {
          return res.status(500).json({ error: "Failed to activate charge" });
        }

        res.json({ success: true });
      } catch (error) {
        logger.error("Error activating charge:", error);
        res.status(500).json({ error: "Failed to activate charge" });
      }
    }
  );

  app.post("/api/subscription/cancel", async (_req: Request, res: Response) => {
    try {
      const { shop, accessToken } = res.locals.shopify;
      const subscription = await subscriptionService.getSubscription(shop);

      if (subscription.shopifyChargeId) {
        const chargeId = parseInt(subscription.shopifyChargeId);
        await shopifyBillingService.cancelCharge(shop, accessToken, chargeId);
      } else {
        // Just downgrade if no charge ID
        await subscriptionService.cancelSubscription(shop);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("Error cancelling subscription:", error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
