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
      path.startsWith("/webhooks")
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
      const webhooks = await shopifyService.listWebhooks(shop, accessToken);

      const ordersCreateWebhook = webhooks.find(
        (wh) => wh.topic === "orders/create"
      );
      const ordersUpdatedWebhook = webhooks.find(
        (wh) => wh.topic === "orders/updated"
      );

      res.json({
        registered: !!(ordersCreateWebhook && ordersUpdatedWebhook),
        webhooks: {
          ordersCreate: ordersCreateWebhook || null,
          ordersUpdated: ordersUpdatedWebhook || null,
        },
        totalWebhooks: webhooks.length,
        allWebhooks: webhooks,
      });
    } catch (error) {
      logger.error("[API] Error checking webhook status:", error);
      res.status(500).json({
        error: "Failed to check webhook status",
        details: error instanceof Error ? error.message : String(error),
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
      
      const ordersCreateResult = await shopifyService.registerWebhook(
        shop,
        accessToken,
        "orders/create",
        `${baseUrl}/api/webhooks/shopify/orders/create`
      );
      
      const ordersUpdatedResult = await shopifyService.registerWebhook(
        shop,
        accessToken,
        "orders/updated",
        `${baseUrl}/api/webhooks/shopify/orders/updated`
      );

      const allSuccess =
        ordersCreateResult.success && ordersUpdatedResult.success;

      res.json({
        success: allSuccess,
        webhooks: {
          ordersCreate: ordersCreateResult,
          ordersUpdated: ordersUpdatedResult,
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

  // Diagnostic endpoint to help troubleshoot webhook verification
  app.get("/api/webhooks/diagnostic", async (_req: Request, res: Response) => {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
    res.json({
      configured: {
        shopDomain: !!process.env.SHOPIFY_SHOP_DOMAIN, // Legacy check
        accessToken: !!process.env.SHOPIFY_ACCESS_TOKEN, // Legacy check
        webhookSecret: !!secret,
      },
      secretInfo: {
        length: secret.length,
        prefix: secret.substring(0, 6) + "...",
        startsWithShpss: secret.startsWith("shpss_"),
        startsWithShpat: secret.startsWith("shpat_"),
        expectedFormat:
          "Should be the 'API secret key' from Shopify app credentials (NOT the access token)",
      },
      instructions: [
        "1. Go to Shopify Admin → Settings → Apps → Develop apps",
        "2. Click your custom app",
        "3. Go to 'App credentials' tab",
        "4. Copy the 'API secret key' (NOT the 'Admin API access token')",
        "5. Update SHOPIFY_WEBHOOK_SECRET with that value",
      ],
    });
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
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const shopDomain = req.get("X-Shopify-Shop-Domain");
        // With express.raw middleware, req.body is the raw Buffer
        const rawBody: Buffer = req.body;

        logger.debug(`[Webhook] Received webhook for shop: ${shopDomain}`);

        // Verify HMAC signature using raw bytes
        if (!hmacHeader) {
          logger.error("[Webhook] ❌ Missing HMAC header");
          return res
            .status(401)
            .json({ error: "Missing webhook signature header" });
        }

        if (!shopifyService.verifyWebhook(rawBody, hmacHeader)) {
          logger.warn("[Webhook] ❌ Invalid webhook signature");
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        logger.debug("[Webhook] ✅ Signature verified successfully!");

        // Parse JSON after verification
        const shopifyOrder = JSON.parse(rawBody.toString("utf8"));

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
                logger.info("[Webhook] ✅ Successfully fetched order via API");
                Object.assign(shopifyOrder, {
                  email: fetchedOrder.email || shopifyOrder.email,
                  contact_email:
                    fetchedOrder.contact_email || shopifyOrder.contact_email,
                });
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
                  "[Webhook] ✅ Successfully fetched customer via API"
                );
                customerData = apiCustomer;
              }
            } catch (err) {
              logger.warn("[Webhook] ⚠️ Customer API fetch failed", err);
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

        const duplicateMatch = await duplicateDetectionService.findDuplicates(
          validatedOrder
        );

        if (duplicateMatch) {
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
            const updatedOrder = await storage.getOrder(shopDomain, flaggedOrder.id);
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

          const updatedOrder = await storage.getOrder(shopDomain, flaggedOrder.id);
          res.json({
            success: true,
            flagged: true,
            order: updatedOrder,
          });
        } else {
          const order = await storage.createOrder(validatedOrder);

          // Record order for quota tracking
          if (shopDomain) {
            try {
              await subscriptionService.recordOrder(shopDomain);
            } catch (error) {
              logger.error("Failed to record order for quota:", error);
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
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const shopDomain = req.get("X-Shopify-Shop-Domain");
        // With express.raw middleware, req.body is the raw Buffer
        const rawBody: Buffer = req.body;

        logger.debug("[Webhook] Received orders/updated webhook");

        // Verify HMAC signature using raw bytes
        if (!hmacHeader) {
          logger.error("[Webhook] ❌ Missing HMAC header");
          return res
            .status(401)
            .json({ error: "Missing webhook signature header" });
        }

        if (!shopifyService.verifyWebhook(rawBody, hmacHeader)) {
          logger.warn("[Webhook] ❌ Invalid webhook signature");
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        logger.debug("[Webhook] ✅ Signature verified successfully!");

        // Parse JSON after verification
        const shopifyOrder = JSON.parse(rawBody.toString("utf8"));

        // Check if order exists in our database
        const order = await storage.getOrderByShopifyId(
          shopDomain,
          shopifyOrder.id.toString()
        );

        if (!order) {
          logger.debug("[Webhook] Order not found in database, skipping");
          return res.json({ success: true, message: "Order not tracked" });
        }

        // Only process if order is currently flagged
        if (!order.isFlagged) {
          logger.debug("[Webhook] Order is not flagged, skipping");
          return res.json({ success: true, message: "Order not flagged" });
        }

        // Check if "Merge_Review_Candidate" tag was removed
        const currentTags = shopifyOrder.tags
          ? shopifyOrder.tags.split(", ").map((t: string) => t.trim())
          : [];
        const hasTag = currentTags.includes("Merge_Review_Candidate");

        if (hasTag) {
          logger.debug("[Webhook] Tag still present, no action needed");
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
  
  // Subscription endpoints
  app.get("/api/subscription", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const subscription = await subscriptionService.getSubscription(shop);
      res.json(subscription);
    } catch (error) {
      logger.error("Error fetching subscription:", error);
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

        const success = await shopifyBillingService.activateCharge(shop, accessToken, chargeId);
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
