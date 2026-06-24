import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { FREE_TIER_ORDER_LIMIT, storage } from "./storage";
import { db } from "./db";
import {
  orders,
  subscriptions,
  shopifySessions,
  webhookDeliveries,
} from "@shared/schema";
import { eq, desc, and, isNotNull, sql } from "drizzle-orm";
import { duplicateDetectionService } from "./services/duplicate-detection.service";
import { shopifyService } from "./services/shopify.service";
import { notificationService } from "./services/notification.service";
import { subscriptionService } from "./services/subscription.service";
import { shopifyBillingService } from "./services/shopify-billing.service";
import { reviewPromptService } from "./services/review-prompt.service";
import {
  buildOrderCreateDeliveryId,
  buildOrderCreateJobKey,
} from "./services/webhook-processor.service";
import {
  insertOrderSchema,
  updateDetectionSettingsSchema,
} from "@shared/schema";
import { randomUUID, timingSafeEqual } from "crypto";
import { logger } from "./utils/logger";
import { queueService } from "./services/queue.service";
import { pool } from "./db";


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

import {
  auth,
  authCallback,
  verifyRequest,
  shopify,
  getOfflineAccessToken,
  forceRefreshOfflineToken,
  storeSessionWithRetry,
} from "./shopify-auth";

async function redirectLegacyInstallLaunch(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const shopParam = req.query.shop;
  const hostParam = req.query.host;

  if (typeof shopParam !== "string") {
    return next();
  }

  const shop = shopify.utils.sanitizeShop(shopParam, false);
  if (!shop) {
    logger.warn(`[Auth] Invalid shop parameter on app launch: ${shopParam}`);
    return res.status(400).send("Invalid shop parameter");
  }

  if (typeof hostParam === "string") {
    try {
      const offlineSessionId = shopify.session.getOfflineId(shop);
      const session = await shopify.config.sessionStorage.loadSession(
        offlineSessionId
      );

      if (session?.accessToken) {
        // Fallback migration: if this shop is still on a non-expiring offline
        // token (no refresh token), migrate it to an expiring token in the
        // background. Fire-and-forget so we never block the app launch.
        if (!session.refreshToken) {
          void (async () => {
            try {
              const { session: migrated } =
                await shopify.auth.migrateToExpiringToken({
                  shop,
                  nonExpiringOfflineAccessToken: session.accessToken!,
                });
              // The exchange revokes the old non-expiring token immediately, so
              // we MUST persist the new refresh token or the shop is stranded.
              const stored = await storeSessionWithRetry(migrated);
              if (stored) {
                logger.info(
                  `[Auth] Migrated ${shop} to an expiring offline token on app launch`
                );
              } else {
                logger.error(
                  `[Auth] CRITICAL: Migrated ${shop} to an expiring token but failed to persist it. The shop may need to reinstall.`
                );
              }
            } catch (error: any) {
              logger.warn(
                `[Auth] On-launch token migration failed for ${shop}: ${error?.message}`
              );
            }
          })();
        }
        return next();
      }
    } catch (error) {
      logger.warn(`[Auth] Failed to check offline session for ${shop}:`, error);
    }
  }

  const authUrl = `/api/auth?shop=${encodeURIComponent(shop)}`;

  if (typeof hostParam === "string") {
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const absoluteAuthUrl = new URL(authUrl, appUrl).toString();
    const exitIframeUrl = new URL(
      `/exitiframe?exitIframe=${encodeURIComponent(absoluteAuthUrl)}`,
      appUrl
    ).toString();

    logger.info(
      `[Auth] Embedded app launched without an offline session; escaping iframe for OAuth: ${shop}`
    );
    return res.redirect(exitIframeUrl);
  }

  logger.info(
    `[Auth] App launched without embedded host context; starting OAuth for ${shop}`
  );
  return res.redirect(authUrl);
}

function getConfiguredAdminToken(): string | undefined {
  return process.env.INTERNAL_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

function requireInternalAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const configuredToken = getConfiguredAdminToken();

  if (!configuredToken && process.env.NODE_ENV === "production") {
    logger.error("[InternalAdmin] Missing INTERNAL_ADMIN_TOKEN in production");
    return res.status(503).json({ error: "Internal admin is not configured" });
  }

  const expectedToken = configuredToken || "dev-admin-token";
  const providedToken =
    req.get("X-Admin-Token") ||
    (typeof req.query.token === "string" ? req.query.token : "");

  if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
    return res.status(401).json({ error: "Invalid admin token" });
  }

  next();
}

async function getWebhookOpsData(shop: string) {
  try {
    return await getWebhookOpsDataWithDeliveryStatus(shop);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('column "status" does not exist')) {
      logger.warn(
        `[WebhookOps] Falling back to legacy webhook delivery stats for ${shop}; status columns are missing.`
      );
      return getLegacyWebhookOpsData(shop);
    }

    throw error;
  }
}

async function getWebhookQueueStats() {
  try {
    const { queueService } = await import("./services/queue.service");
    return await queueService.getHealthStats();
  } catch (error) {
    logger.warn("[WebhookOps] Failed to load queue stats:", error);
    return { status: "error", error: String(error) };
  }
}

async function getWebhookOpsDataWithDeliveryStatus(shop: string) {
  const statusRows = await db
    .select({
      status: webhookDeliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopDomain, shop))
    .groupBy(webhookDeliveries.status);

  const [rollup] = await db
    .select({
      total: sql<number>`count(*)::int`,
      receivedLastHour: sql<number>`
        count(*) filter (
          where ${webhookDeliveries.receivedAt} >= now() - interval '1 hour'
        )::int
      `,
      failedLastDay: sql<number>`
        count(*) filter (
          where ${webhookDeliveries.status} = 'failed'
            and coalesce(${webhookDeliveries.failedAt}, ${webhookDeliveries.receivedAt}) >= now() - interval '24 hours'
        )::int
      `,
      staleQueuedOrProcessing: sql<number>`
        count(*) filter (
          where ${webhookDeliveries.status} in ('queued', 'processing')
            and ${webhookDeliveries.receivedAt} < now() - interval '15 minutes'
        )::int
      `,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopDomain, shop));

  const deliveryColumns = {
    id: webhookDeliveries.id,
    deliveryId: webhookDeliveries.deliveryId,
    topic: webhookDeliveries.topic,
    status: webhookDeliveries.status,
    attemptCount: webhookDeliveries.attemptCount,
    lastError: webhookDeliveries.lastError,
    receivedAt: webhookDeliveries.receivedAt,
    processedAt: webhookDeliveries.processedAt,
    failedAt: webhookDeliveries.failedAt,
  };

  const recentDeliveries = await db
    .select(deliveryColumns)
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopDomain, shop))
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(50);

  const failedDeliveries = await db
    .select(deliveryColumns)
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.shopDomain, shop),
        eq(webhookDeliveries.status, "failed")
      )
    )
    .orderBy(desc(webhookDeliveries.failedAt), desc(webhookDeliveries.receivedAt))
    .limit(25);

  const staleDeliveries = await db
    .select(deliveryColumns)
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.shopDomain, shop),
        sql`${webhookDeliveries.status} in ('queued', 'processing')`,
        sql`${webhookDeliveries.receivedAt} < now() - interval '15 minutes'`
      )
    )
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(25);

  return {
    shop,
    generatedAt: new Date().toISOString(),
    rollup: rollup ?? {
      total: 0,
      receivedLastHour: 0,
      failedLastDay: 0,
      staleQueuedOrProcessing: 0,
    },
    statusCounts: statusRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {}),
    queue: await getWebhookQueueStats(),
    recentDeliveries,
    failedDeliveries,
    staleDeliveries,
  };
}

async function getLegacyWebhookOpsData(shop: string) {
  const [rollup] = await db
    .select({
      total: sql<number>`count(*)::int`,
      receivedLastHour: sql<number>`
        count(*) filter (
          where ${webhookDeliveries.processedAt} >= now() - interval '1 hour'
        )::int
      `,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopDomain, shop));

  const recentDeliveries = await db
    .select({
      id: webhookDeliveries.id,
      deliveryId: webhookDeliveries.deliveryId,
      topic: webhookDeliveries.topic,
      status: sql<"processed">`'processed'`,
      attemptCount: sql<number>`0`,
      lastError: sql<string | null>`null`,
      receivedAt: webhookDeliveries.processedAt,
      processedAt: webhookDeliveries.processedAt,
      failedAt: sql<Date | null>`null`,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopDomain, shop))
    .orderBy(desc(webhookDeliveries.processedAt))
    .limit(50);

  const total = Number(rollup?.total || 0);

  return {
    shop,
    generatedAt: new Date().toISOString(),
    legacyMode: true,
    rollup: {
      total,
      receivedLastHour: Number(rollup?.receivedLastHour || 0),
      failedLastDay: 0,
      staleQueuedOrProcessing: 0,
    },
    statusCounts: {
      processed: total,
    },
    queue: await getWebhookQueueStats(),
    recentDeliveries,
    failedDeliveries: [],
    staleDeliveries: [],
  };
}

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

  // Shopify legacy install launches hit the configured application_url with a
  // shop parameter before embedded App Bridge context exists. Start OAuth here
  // so the SPA does not stall on the "Missing Shopify Context" screen.
  app.get("/", redirectLegacyInstallLaunch);

  // Exitiframe route for OAuth redirects in embedded apps
  // This route is used to break out of the Shopify admin iframe when re-authentication is needed
  app.get("/exitiframe", (req: Request, res: Response) => {
    const { exitIframe } = req.query;
    
    if (!exitIframe || typeof exitIframe !== 'string') {
      return res.status(400).send("Missing exitIframe parameter");
    }

    // Validate exitIframe URL to prevent open redirects
    const appUrl = process.env.APP_URL || "http://localhost:5000";
    try {
      const url = new URL(exitIframe);
      const appUrlObj = new URL(appUrl);
      
      // Only allow URLs from the same origin
      if (url.protocol !== appUrlObj.protocol || url.hostname !== appUrlObj.hostname) {
        logger.warn(`[Security] Invalid exitiframe URL rejected: ${exitIframe}`);
        return res.status(400).send("Invalid redirect URL");
      }
    } catch (error) {
      logger.warn(`[Security] Invalid exitiframe URL format: ${exitIframe}`);
      return res.status(400).send("Invalid URL format");
    }

    // Return HTML that uses App Bridge to break out of iframe and redirect
    // No visible content - redirect happens instantly
    const apiKey = process.env.SHOPIFY_API_KEY || "";
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="shopify-api-key" content="${apiKey}">
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        </head>
        <body>
          <script>
            // App Bridge v4 hooks into the browser open() API for top-frame
            // navigation from embedded app routes.
            try {
                window.open(${JSON.stringify(exitIframe)}, "_top");
            } catch (e) {
                console.error("Top-frame open failed:", e);
                fallbackRedirect();
            }

            function fallbackRedirect() {
                try {
                    if (window.top && window.top !== window) {
                        window.top.location.href = ${JSON.stringify(exitIframe)};
                    } else {
                        window.location.href = ${JSON.stringify(exitIframe)};
                    }
                } catch (e) {
                    // If top access is blocked, try standard navigation as last resort
                    window.location.href = ${JSON.stringify(exitIframe)};
                }
            }
          </script>
        </body>
      </html>
    `);
  });

  // Liveness - cheap check that the process is running
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness - verifies database connectivity and queue worker availability
  app.get("/api/ready", async (_req, res) => {
    let dbStatus = false;
    try {
      await pool.query("SELECT 1");
      dbStatus = true;
    } catch (error) {
      logger.error("[Ready] Database readiness check failed:", error);
    }

    const queueReady = queueService.getReady() && queueService.isWorkerRegistered();
    let queueStats: Record<string, unknown> = { status: "stopped" };

    try {
      queueStats = await queueService.getHealthStats();
    } catch (error) {
      logger.warn("[Ready] Failed to get queue stats:", error);
      queueStats = { status: "error" };
    }

    const ready = dbStatus && queueReady;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      database: dbStatus ? "connected" : "disconnected",
      queue: queueStats,
      timestamp: new Date().toISOString(),
    });
  });

  // GlitchTip test route – only throws in development so production cannot be spammed
  app.get("/api/debug-glitchtip", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not Found" });
    }
    throw new Error("My first GlitchTip error!");
  });

  // Webhook routes (bypass auth middleware)
  // ... (webhooks are registered below)

  // Protected API Routes
  // Apply middleware to all /api routes EXCEPT auth, webhooks, internal, and health
  app.use("/api", (req, res, next) => {
    const path = req.path;
    if (
      path.startsWith("/auth") ||
      path.startsWith("/webhooks/shopify") ||
      path.startsWith("/internal") ||
      path === "/health" ||
      path === "/ready" ||
      path === "/debug-glitchtip"
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

  app.get("/api/review-prompt", async (req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const testOverride = req.query.testReviewPrompt === "true";

      const promptState = await reviewPromptService.getPromptState(shop, {
        forceShow: testOverride,
      });

      res.json(promptState);
    } catch (error) {
      logger.error("Error fetching review prompt state:", error);
      res.status(500).json({ error: "Failed to fetch review prompt state" });
    }
  });

  app.post("/api/review-prompt", async (req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const { intent, branch } = req.body ?? {};

      if (!intent || typeof intent !== "string") {
        return res.status(400).json({ error: "intent is required" });
      }

      switch (intent) {
        case "dismiss":
          await reviewPromptService.dismiss(shop);
          break;
        case "defer":
          await reviewPromptService.defer(shop);
          break;
        case "select-branch":
          if (branch !== "positive" && branch !== "negative") {
            return res.status(400).json({
              error: "branch must be either 'positive' or 'negative'",
            });
          }
          await reviewPromptService.selectBranch(shop, branch);
          break;
        case "cta-click":
          await reviewPromptService.recordCtaClick(shop);
          break;
        default:
          return res.status(400).json({ error: "Unknown review prompt intent" });
      }

      const promptState = await reviewPromptService.getPromptState(shop);
      res.json({ success: true, prompt: promptState });
    } catch (error) {
      logger.error("Error updating review prompt state:", error);
      res.status(500).json({ error: "Failed to update review prompt state" });
    }
  });

  const parsePaginationParam = (value: unknown): number | undefined => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    if (rawValue === undefined || rawValue === "") {
      return undefined;
    }

    const parsed = Number.parseInt(String(rawValue), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  app.get("/api/orders/flagged", async (req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const limit = parsePaginationParam(req.query.limit);
      const offset = parsePaginationParam(req.query.offset);
      const result = await storage.getFlaggedOrders(shop, { limit, offset });
      res.json(result);
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

      // Check subscription if user is trying to enable notifications
      if (validatedData.enableNotifications) {
        const subscription = await subscriptionService.getSubscription(shop);
        if (subscription.tier !== "paid") {
          logger.warn(
            `[Settings] Shop ${shop} (free tier) attempted to enable notifications. Forcing disabled.`
          );
          validatedData.enableNotifications = false;
        }
      }

      const settings = await storage.updateSettings(shop, validatedData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(400).json({ error: "Invalid settings data" });
    }
  });

  // Support request endpoint
  app.post("/api/support", async (req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      const {
        requestType,
        subject,
        description,
        priority,
        source,
        sentiment,
        promptVersion,
      } = req.body;

      // Validate required fields
      if (!requestType || !subject || !description) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Get subscription info for context
      let tier = "free";
      let merchantEmail: string | undefined;
      try {
        const subscription = await subscriptionService.getSubscription(shop);
        tier = subscription?.tier || "free";
      } catch (error) {
        logger.warn(`[Support] Could not fetch subscription for ${shop}:`, error);
      }

      // Try to get merchant email from session
      try {
        const { shopifySessions } = await import("@shared/schema");
        const { db } = await import("./db");
        const { eq } = await import("drizzle-orm");
        
        const [session] = await db
          .select()
          .from(shopifySessions)
          .where(eq(shopifySessions.shop, shop))
          .limit(1);
        
        merchantEmail = session?.email || undefined;
      } catch (error) {
        logger.warn(`[Support] Could not fetch merchant email for ${shop}:`, error);
      }

      // Send the support request email
      await notificationService.sendSupportRequest({
        shopDomain: shop,
        tier,
        requestType,
        subject,
        description,
        priority,
        merchantEmail,
        source,
        sentiment,
        promptVersion,
      });

      logger.info(`[Support] Support request submitted from ${shop}: ${requestType} - ${subject}`);

      res.json({
        success: true,
        message: "Support request submitted successfully",
      });
    } catch (error) {
      logger.error("[Support] Error submitting support request:", error);
      res.status(500).json({
        error: "Failed to submit support request",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Onboarding status — single lightweight call for the setup checklist
  // Returns webhook health, last order received, subscription quota, and
  // detection config readiness so the UI can guide merchants step-by-step.
  // ---------------------------------------------------------------------------
  app.get("/api/onboarding/status", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;

      // 1. Subscription / quota status
      const subscription = await subscriptionService.getSubscription(shop);
      const quotaUsed = subscription.monthlyOrderCount;
      const quotaLimit = subscription.orderLimit; // -1 = unlimited
      const quotaPercent =
        quotaLimit === -1 ? 0 : Math.round((quotaUsed / quotaLimit) * 100);

      // 2. Detection settings readiness
      const settings = await storage.getSettings(shop);
      const hasAnyMatchCriteria =
        settings &&
        (settings.matchEmail ||
          settings.matchPhone ||
          settings.matchAddress ||
          settings.matchSku);

      // 3. Last order received (most recent order in DB regardless of flagged status)
      const [lastOrder] = await db
        .select({ createdAt: orders.createdAt, orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.shopDomain, shop))
        .orderBy(desc(orders.createdAt))
        .limit(1);

      // 4. Webhook registration (lightweight: just check DB delivery records instead
      //    of making a Shopify API call on every page load)
      const [lastDelivery] = await db
        .select({ processedAt: webhookDeliveries.processedAt })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.shopDomain, shop))
        .orderBy(desc(webhookDeliveries.processedAt))
        .limit(1);

      // 5. PII hint: if we have orders but email is missing on most, PII may be blocked.
      //    We infer this by checking if any stored order has a non-null customer email.
      const [orderWithEmail] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shop),
            isNotNull(orders.customerEmail)
          )
        )
        .limit(1);

      const totalOrders = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.shopDomain, shop));

      const totalOrderCount = totalOrders[0]?.count || 0;
      // PII is likely blocked if we have orders but none of them have an email
      const piiLikelyBlocked =
        totalOrderCount > 0 && !orderWithEmail;

      res.json({
        // App installed (always true if we get here)
        appInstalled: true,

        // Webhook delivery evidence (healthy if we have at least one delivery record)
        webhooksReceived: !!lastDelivery,
        lastWebhookReceivedAt: lastDelivery?.processedAt || null,

        // Order processing
        totalOrdersProcessed: totalOrderCount,
        lastOrderReceivedAt: lastOrder?.createdAt || null,
        lastOrderNumber: lastOrder?.orderNumber || null,

        // Detection configuration
        detectionConfigured: !!hasAnyMatchCriteria,
        detectionSettings: settings
          ? {
              matchEmail: settings.matchEmail,
              matchPhone: settings.matchPhone,
              matchAddress: settings.matchAddress,
              matchSku: settings.matchSku,
              timeWindowHours: settings.timeWindowHours,
            }
          : null,

        // PII access hint
        piiAccessLikelyBlocked: piiLikelyBlocked,

        // Quota
        subscription: {
          tier: subscription.tier,
          status: subscription.status,
          quotaUsed,
          quotaLimit,
          quotaPercent,
        },
      });
    } catch (error) {
      logger.error("[API] Error fetching onboarding status:", error);
      res.status(500).json({ error: "Failed to fetch onboarding status" });
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

      // Shopify offline tokens are 38 characters (shpat_ prefix + 32 random chars)
      // Only warn if significantly shorter, which would indicate truncation or corruption
      if (accessToken.length < 30) {
        logger.warn(
          `[API] Access token is unusually short (${accessToken.length} chars). This may indicate truncation or corruption.`
        );
        // Don't fail here, but log a warning - let the API call determine if it's actually invalid
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
      const customersDataRequestWebhook = webhooks.find(
        (wh) => wh.topic === "customers/data_request"
      );
      const customersRedactWebhook = webhooks.find(
        (wh) => wh.topic === "customers/redact"
      );
      const shopRedactWebhook = webhooks.find(
        (wh) => wh.topic === "shop/redact"
      );

      const allRequiredWebhooks =
        ordersCreateWebhook && ordersUpdatedWebhook && appUninstalledWebhook;

      res.json({
        registered: !!allRequiredWebhooks,
        webhooks: {
          ordersCreate: ordersCreateWebhook || null,
          ordersUpdated: ordersUpdatedWebhook || null,
          appUninstalled: appUninstalledWebhook || null,
          customersDataRequest: customersDataRequestWebhook || null,
          customersRedact: customersRedactWebhook || null,
          shopRedact: shopRedactWebhook || null,
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
        errorMessage.includes("authentication failed") ||
        errorMessage.includes("Invalid API key or access token");

      // If it's an auth error, first try to refresh an expiring offline token
      // (the token may have been retired/rotated). Only if refresh is not
      // possible do we clear the session and force a full re-auth.
      let refreshed = false;
      if (isAuthError) {
        const shop = res.locals.shopify?.shop;

        if (shop) {
          try {
            refreshed = await forceRefreshOfflineToken(shop);
          } catch (err) {
            logger.error(`[API] Error attempting token refresh:`, err);
          }

          if (refreshed) {
            logger.info(
              `[API] Refreshed offline token for shop ${shop} after auth failure. Client can retry.`
            );
          } else {
            logger.warn(
              `[API] Authentication failed for shop ${shop} and refresh was not possible. Clearing invalid session.`
            );
            try {
              const offlineSessionId = shopify.session.getOfflineId(shop);
              await shopify.config.sessionStorage.deleteSession(
                offlineSessionId
              );
              logger.info(
                `[API] Deleted invalid session ${offlineSessionId}. Triggering re-authentication...`
              );
            } catch (err) {
              logger.error(`[API] Failed to delete invalid session:`, err);
              logger.info(
                `[API] Session deletion failed, but still triggering re-authentication...`
              );
            }
          }
        } else {
          logger.error(`[API] Cannot clear session: shop domain is undefined`);
        }
      }

      // If we refreshed the token, signal a transient retry of the SAME request
      // (retryRequest) rather than re-auth (retryAuth), so the client does not
      // bounce the merchant through OAuth for a token we already rotated.
      res.status(isAuthError ? 401 : 500).json({
        error: "Failed to check webhook status",
        details: errorMessage,
        retryRequest: isAuthError && refreshed, // Client should retry the request once
        retryAuth: isAuthError && !refreshed, // Only trigger re-auth if refresh failed
        requiresReinstall: isAuthError && !refreshed, // Only force reinstall if refresh failed
        shop: res.locals.shopify?.shop,
        message: isAuthError
          ? refreshed
            ? "The access token was refreshed. Please retry the request."
            : "The access token is invalid. Redirecting to re-authenticate..."
          : "An error occurred while checking webhook status.",
      });
    }
  });

  app.get("/api/webhook-ops", async (_req: Request, res: Response) => {
    try {
      const { shop } = res.locals.shopify;
      res.json(await getWebhookOpsData(shop));
    } catch (error) {
      logger.error("[WebhookOps] Failed to load webhook ops view:", error);
      res.status(500).json({
        error: "Failed to load webhook ops view",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get(
    "/api/internal/admin/shops/:shopDomain/webhook-ops",
    requireInternalAdmin,
    async (req: Request, res: Response) => {
      try {
        res.json(await getWebhookOpsData(req.params.shopDomain));
      } catch (error) {
        logger.error("[WebhookOps] Failed to load internal webhook ops view:", error);
        res.status(500).json({
          error: "Failed to load webhook ops view",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

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

      const appSubscriptionsUpdateResult =
        await shopifyService.registerWebhookWithRetry(
          shop,
          accessToken,
          "app_subscriptions/update",
          `${baseUrl}/api/webhooks/shopify/app_subscriptions/update`
        );

      // Note: GDPR compliance webhooks (customers/data_request, customers/redact, shop/redact)
      // are now configured via shopify.app.toml and use the unified endpoint /api/webhooks/shopify
      // They should NOT be registered here to avoid conflicts with TOML configuration

      const allSuccess =
        ordersCreateResult.success &&
        ordersUpdatedResult.success &&
        appUninstalledResult.success &&
        appSubscriptionsUpdateResult.success;

      res.json({
        success: allSuccess,
        webhooks: {
          ordersCreate: ordersCreateResult,
          ordersUpdated: ordersUpdatedResult,
          appUninstalled: appUninstalledResult,
          appSubscriptionsUpdate: appSubscriptionsUpdateResult,
        },
        message: allSuccess
          ? "All webhooks registered successfully"
          : "Some webhooks failed to register",
        note: "GDPR webhooks are configured via shopify.app.toml",
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

  app.get(
    "/api/internal/admin/shops",
    requireInternalAdmin,
    async (_req: Request, res: Response) => {
      try {
        const rows = await db
          .select({
            id: subscriptions.id,
            shopDomain: subscriptions.shopifyShopDomain,
            tier: subscriptions.tier,
            status: subscriptions.status,
            monthlyOrderCount: subscriptions.monthlyOrderCount,
            allTimeOrderCount: subscriptions.allTimeOrderCount,
            orderLimit: subscriptions.orderLimit,
            currentBillingPeriodStart:
              subscriptions.currentBillingPeriodStart,
            currentBillingPeriodEnd: subscriptions.currentBillingPeriodEnd,
            shopifyChargeId: subscriptions.shopifyChargeId,
            createdAt: subscriptions.createdAt,
            updatedAt: subscriptions.updatedAt,
            totalOrders: sql<number>`COALESCE((
              SELECT COUNT(*)::int
              FROM ${orders}
              WHERE ${orders.shopDomain} = ${subscriptions.shopifyShopDomain}
            ), 0)`,
            flaggedOrders: sql<number>`COALESCE((
              SELECT COUNT(*)::int
              FROM ${orders}
              WHERE ${orders.shopDomain} = ${subscriptions.shopifyShopDomain}
                AND ${orders.isFlagged} = true
            ), 0)`,
            lastOrderAt: sql<Date | null>`(
              SELECT MAX(${orders.createdAt})
              FROM ${orders}
              WHERE ${orders.shopDomain} = ${subscriptions.shopifyShopDomain}
            )`,
            merchantEmail: sql<string | null>`(
              SELECT MAX(${shopifySessions.email})
              FROM ${shopifySessions}
              WHERE ${shopifySessions.shop} = ${subscriptions.shopifyShopDomain}
            )`,
            merchantName: sql<string | null>`(
              SELECT NULLIF(
                TRIM(CONCAT(
                  MAX(${shopifySessions.firstName}),
                  ' ',
                  MAX(${shopifySessions.lastName})
                )),
                ''
              )
              FROM ${shopifySessions}
              WHERE ${shopifySessions.shop} = ${subscriptions.shopifyShopDomain}
            )`,
          })
          .from(subscriptions)
          .orderBy(desc(subscriptions.updatedAt));

        const shops = rows.map((row) => ({
          ...row,
          totalOrders: Number(row.totalOrders || 0),
          flaggedOrders: Number(row.flaggedOrders || 0),
        }));

        const summary = shops.reduce(
          (acc, shop) => {
            acc.total += 1;
            if (shop.tier === "paid" && shop.status !== "complimentary") {
              acc.paid += 1;
            }
            if (shop.tier === "free") acc.free += 1;
            if (shop.status === "complimentary") acc.complimentary += 1;
            acc.flaggedOrders += shop.flaggedOrders;
            return acc;
          },
          {
            total: 0,
            free: 0,
            paid: 0,
            complimentary: 0,
            flaggedOrders: 0,
          }
        );

        res.json({ shops, summary });
      } catch (error) {
        logger.error("[InternalAdmin] Error fetching shops:", error);
        res.status(500).json({ error: "Failed to fetch shops" });
      }
    }
  );

  app.post(
    "/api/internal/admin/shops/:shopDomain/grant-complimentary",
    requireInternalAdmin,
    async (req: Request, res: Response) => {
      try {
        const { shopDomain } = req.params;
        const requestedDays = Number(req.body?.days ?? 30);
        const days = Number.isFinite(requestedDays)
          ? Math.min(365, Math.max(1, Math.floor(requestedDays)))
          : 30;

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setDate(periodEnd.getDate() + days);

        let subscription = await storage.getSubscription(shopDomain);
        if (!subscription) {
          subscription = await storage.initializeSubscription(shopDomain);
        }

        const updated = await storage.updateSubscription(shopDomain, {
          tier: "paid",
          status: "complimentary",
          orderLimit: -1,
          shopifyChargeId: null,
          currentBillingPeriodStart: now,
          currentBillingPeriodEnd: periodEnd,
          quotaExceededNotifiedAt: null,
        });

        logger.info(
          `[InternalAdmin] Granted ${days} complimentary days to ${shopDomain}`
        );

        res.json({
          success: true,
          subscription: updated,
          message: `Granted ${days} complimentary days to ${shopDomain}`,
        });
      } catch (error) {
        logger.error("[InternalAdmin] Error granting complimentary access:", error);
        res.status(500).json({
          error: "Failed to grant complimentary access",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  app.post(
    "/api/internal/admin/shops/:shopDomain/revoke-complimentary",
    requireInternalAdmin,
    async (req: Request, res: Response) => {
      try {
        const { shopDomain } = req.params;
        const subscription = await storage.getSubscription(shopDomain);

        if (!subscription) {
          return res.status(404).json({ error: "Subscription not found" });
        }

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setDate(periodEnd.getDate() + 30);

        const updated = await storage.updateSubscription(shopDomain, {
          tier: "free",
          status: "active",
          orderLimit: FREE_TIER_ORDER_LIMIT,
          currentBillingPeriodStart: now,
          currentBillingPeriodEnd: periodEnd,
          shopifyChargeId: null,
        });

        logger.info(
          `[InternalAdmin] Revoked complimentary access for ${shopDomain}`
        );

        res.json({
          success: true,
          subscription: updated,
          message: `Revoked complimentary access for ${shopDomain}`,
        });
      } catch (error) {
        logger.error("[InternalAdmin] Error revoking complimentary access:", error);
        res.status(500).json({
          error: "Failed to revoke complimentary access",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Internal cleanup endpoint (for scheduled jobs like Ofelia)
  app.post("/api/internal/cleanup", async (_req: Request, res: Response) => {
    try {
      const { cleanupService } = await import("./services/cleanup.service.js");
      const deletedCount = await cleanupService.cleanupOldWebhookDeliveries();
      
      res.json({
        success: true,
        deletedCount,
        message: `Cleaned up ${deletedCount} old webhook delivery records`,
      });
    } catch (error) {
      logger.error("[Cleanup] Error running cleanup:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
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
    "/api/webhooks/shopify/app_subscriptions/update",
    async (req: any, res: Response) => {
      try {
        const rawBody: Buffer = req.body;
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        const shopHeader = req.get("X-Shopify-Shop-Domain");
        const deliveryIdHeader =
          req.get("X-Shopify-Delivery-Id") ||
          req.get("X-Shopify-Webhook-Id") ||
          "";

        if (!hmacHeader) {
          logger.warn(
            "[Webhook] ❌ Missing HMAC header for app_subscriptions/update"
          );
          return res.status(401).json({ error: "Missing HMAC header" });
        }

        const isValid = shopifyService.verifyWebhook(rawBody, hmacHeader);

        if (!isValid) {
          logger.warn(
            `[Webhook] ❌ Invalid webhook signature for app_subscriptions/update`
          );
          return res.status(401).json({ error: "Invalid webhook signature" });
        }

        let shopDomain = shopHeader?.trim();
        if (shopDomain) {
          const sanitized = shopify.utils.sanitizeShop(shopDomain, false);
          if (sanitized) shopDomain = sanitized;
        }
        if (!shopDomain) {
          logger.error("[Webhook] ❌ Missing shop domain header");
          return res.status(400).json({ error: "Missing shop domain" });
        }

        // Record delivery ID for idempotency
        if (deliveryIdHeader) {
          try {
            const isNew = await storage.tryRecordWebhookDelivery({
              shopDomain,
              deliveryId: deliveryIdHeader,
              topic: "app_subscriptions/update",
            });
            if (!isNew) {
              logger.info(
                `[Webhook] ⚠️ Duplicate app_subscriptions/update delivery detected (ID: ${deliveryIdHeader}). Skipping.`
              );
              return res.json({ success: true, duplicate: true });
            }
          } catch (error) {
            logger.error("Failed to record webhook delivery ID:", error);
          }
        }

        const payload = JSON.parse(rawBody.toString("utf8"));
        const subscription = payload.app_subscription;

        logger.info(
          `[Webhook] Received app_subscriptions/update for ${shopDomain}. Status: ${subscription.status}`
        );

        await subscriptionService.syncAppSubscriptionWebhook(
          shopDomain,
          subscription
        );

        res.json({ success: true });
      } catch (error) {
        logger.error(
          "[Webhook] Error processing app_subscriptions/update:",
          error
        );
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

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

        let shopDomain = shopHeader?.trim();
        if (shopDomain) {
          const sanitized = shopify.utils.sanitizeShop(shopDomain, false);
          if (sanitized) shopDomain = sanitized;
        }
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

        // Delivery ID check moved to worker to ensure atomic processing and support retries
        logger.debug(`[Webhook] Passing webhook to queue (Delivery ID: ${deliveryIdHeader})`);

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

        // Load session to get a fresh access token (refreshing expiring tokens
        // as needed). The worker also re-resolves the token at processing time,
        // so this is a best-effort hint passed along with the job.
        let accessToken = "";
        if (shopDomain) {
          try {
            const token = await getOfflineAccessToken(shopDomain);
            if (token) {
              accessToken = token;
            } else {
              logger.warn(
                `[Webhook] ⚠️ Could not load offline session for ${shopDomain}. API calls will fail.`
              );
            }
          } catch (error) {
             logger.warn(`[Webhook] Error loading session:`, error);
          }
        }

        const jobKey = buildOrderCreateJobKey(shopDomain, shopifyOrder.id);

        // Enqueue job for async processing
        const jobData = {
          shopDomain,
          payload: shopifyOrder,
          deliveryId: buildOrderCreateDeliveryId(
            shopDomain,
            shopifyOrder.id,
            deliveryIdHeader
          ),
          accessToken, // Pass token if we have it, otherwise worker will try to fetch it
          webhookTopic: topic || "orders/create",
        };

        const { queueService, QUEUES } = await import("./services/queue.service");
        const jobId = await queueService.addJob(QUEUES.ORDERS_CREATE, jobData, {
          singletonKey: jobKey,
          singletonSeconds: 15 * 60,
        });

        if (jobId) {
           await storage.markWebhookDeliveryQueued({
             shopDomain,
             deliveryId: jobData.deliveryId,
             topic: jobData.webhookTopic,
           });
           logger.info(`[Webhook] Enqueued job ${jobId} for order ${shopifyOrder.id}`);
           res.status(200).json({ success: true, jobId, message: "Webhook accepted for processing" });
        } else {
           logger.info(
             `[Webhook] Order ${shopifyOrder.id} is already queued or processing. Acknowledging duplicate delivery.`
           );
           res.status(200).json({
             success: true,
             duplicate: true,
             message: "Webhook already queued or processing",
           });
        }

      } catch (error) {
        logger.error(
          "[Webhook] Error processing orders/create:",
          error
        );
        res.status(500).json({ error: "Internal server error" });
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

        let shopDomain = shopHeader?.trim();
        if (shopDomain) {
          const sanitized = shopify.utils.sanitizeShop(shopDomain, false);
          if (sanitized) shopDomain = sanitized;
        }
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

  // GDPR Compliance Webhooks - Unified endpoint for all three GDPR webhook types
  // This endpoint handles customers/data_request, customers/redact, and shop/redact
  // Configured via shopify.app.toml with compliance_topics
  app.post("/api/webhooks/shopify", async (req: any, res: Response) => {
    try {
      const rawBody: Buffer = req.body;
      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      const topicHeader = req.get("X-Shopify-Topic");
      const shopHeader = req.get("X-Shopify-Shop-Domain");

      // Validate webhook signature first
      if (!hmacHeader) {
        logger.warn("[Webhook] ❌ Missing HMAC header");
        return res.status(401).json({ error: "Missing HMAC header" });
      }

      const isValid = shopifyService.verifyWebhook(rawBody, hmacHeader);
      if (!isValid) {
        logger.warn(`[Webhook] ❌ Invalid webhook signature.`);
        return res.status(401).json({ error: "Invalid webhook signature" });
      }

      // Parse JSON after verification to check payload for shop_domain
      const webhookData = JSON.parse(rawBody.toString("utf8"));

      // Extract shop_domain from header or payload (tenant routing)
      let shopDomain = shopHeader?.trim() || webhookData.shop_domain?.trim();
      if (webhookData.shop_domain && !shopHeader) {
        logger.info(`[Webhook] Using shop_domain from payload: ${shopDomain}`);
      }
      if (shopDomain) {
        const sanitized = shopify.utils.sanitizeShop(shopDomain, false);
        if (sanitized) shopDomain = sanitized;
      }

      if (!shopDomain) {
        logger.error("[Webhook] ❌ Missing shop domain in header and payload");
        return res.status(400).json({ error: "Missing shop domain" });
      }

      logger.info(
        `[Webhook] ✅ Signature verified successfully! Shop: ${shopDomain}, Topic: ${
          topicHeader || "unknown"
        }`
      );

      // Check for duplicate webhook delivery
      const deliveryIdHeader =
        req.get("X-Shopify-Delivery-Id") ||
        req.get("X-Shopify-Webhook-Id") ||
        "";

      if (deliveryIdHeader) {
        try {
          const isNew = await storage.tryRecordWebhookDelivery({
            shopDomain,
            deliveryId: deliveryIdHeader,
            topic: topicHeader || "unknown",
          });
          if (!isNew) {
            logger.info(
              `[Webhook] ⚠️ Duplicate webhook detected (ID: ${deliveryIdHeader}, Topic: ${topicHeader}). Skipping processing.`
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

      // Route to appropriate handler based on topic
      const topic = topicHeader || "";

      if (topic === "customers/data_request") {
        logger.info(
          `[Webhook] Received customers/data_request webhook, body size: ${rawBody.length} bytes`
        );

        const customerEmail = webhookData.customer?.email;
        const customerId = webhookData.customer?.id;
        const ordersRequested = webhookData.orders_requested || [];

        if (!customerEmail) {
          logger.warn(
            `[Webhook] customers/data_request missing customer email for shop: ${shopDomain}`
          );
          return res.json({
            success: true,
            message: "Request received, but no customer email provided",
          });
        }

        logger.info(
          `[Webhook] Data request for customer: ${customerEmail} (ID: ${customerId}), Orders: ${ordersRequested.length}`
        );

        // Get customer orders from our database
        const customerOrders = await storage.getCustomerOrders(
          shopDomain,
          customerEmail,
          customerId
        );

        // Filter to requested orders if specific orders were requested
        let ordersToReturn = customerOrders;
        if (ordersRequested.length > 0) {
          const requestedOrderIds = ordersRequested.map((id: number) =>
            id.toString()
          );
          ordersToReturn = customerOrders.filter((order) =>
            requestedOrderIds.includes(order.shopifyOrderId)
          );
        }

        logger.info(
          `[Webhook] Found ${ordersToReturn.length} orders for customer ${customerEmail}`
        );

        return res.json({
          success: true,
          message: "Data request received and processed",
          customerEmail,
          customerId,
          ordersFound: ordersToReturn.length,
          dataRequestId: webhookData.data_request?.id,
        });
      } else if (topic === "customers/redact") {
        logger.info(
          `[Webhook] Received customers/redact webhook, body size: ${rawBody.length} bytes`
        );

        const customerEmail = webhookData.customer?.email;
        const customerId = webhookData.customer?.id;
        const ordersToRedact = webhookData.orders_to_redact ?? undefined;

        if (!customerEmail) {
          logger.warn(
            `[Webhook] customers/redact missing customer email for shop: ${shopDomain}`
          );
          return res.json({
            success: true,
            message: "Request received, but no customer email provided",
          });
        }

        logger.info(
          `[Webhook] Redaction request for customer: ${customerEmail} (ID: ${customerId}), Orders to redact: ${
            ordersToRedact?.length ?? 0
          }`
        );

        // Redact customer data
        await storage.redactCustomerData(
          shopDomain,
          customerEmail,
          customerId,
          ordersToRedact
        );

        logger.info(
          `[Webhook] ✅ Successfully redacted customer data for ${customerEmail}`
        );

        return res.json({
          success: true,
          message: "Customer data redacted successfully",
          customerEmail,
          customerId,
          ordersRedacted: ordersToRedact?.length ?? 0,
        });
      } else if (topic === "shop/redact") {
        logger.info(
          `[Webhook] Received shop/redact webhook, body size: ${rawBody.length} bytes`
        );

        logger.info(
          `[Webhook] Shop redaction request for shop: ${shopDomain}. Cleaning up shop data...`
        );

        // Delete all shop data (same as app/uninstalled)
        // Note: shop/redact is sent 48 hours after app uninstall
        // This is a separate webhook for GDPR compliance
        await storage.deleteShopData(shopDomain, deliveryIdHeader || undefined);

        logger.info(
          `[Webhook] ✅ Successfully cleaned up all data for shop: ${shopDomain}`
        );

        return res.json({
          success: true,
          message: "Shop data redacted successfully",
        });
      } else {
        logger.warn(
          `[Webhook] Unknown or unsupported GDPR webhook topic: ${topic}`
        );
        // Still return 200 to acknowledge receipt
        return res.json({
          success: true,
          message: "Webhook received but topic not handled",
          topic,
        });
      }
    } catch (error) {
      logger.error("Error processing GDPR webhook:", error);
      // Still return 200 to acknowledge receipt even if processing fails
      // The action can be completed asynchronously within 30 days
      res.status(200).json({
        success: true,
        message: "Request received, will be processed",
      });
    }
  });

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

        let shopDomain = shopHeader?.trim();
        if (shopDomain) {
          const sanitized = shopify.utils.sanitizeShop(shopDomain, false);
          if (sanitized) shopDomain = sanitized;
        }
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

      // Check for existing charges first to avoid 403 errors
      const existingCharges = await shopifyBillingService.handleExistingCharges(
        shop,
        accessToken,
        returnUrl
      );

      // If there's already a pending charge, reuse it
      if (existingCharges.hasPendingCharge && existingCharges.pendingCharge) {
        logger.info(
          `[Subscription] Found existing pending charge ${existingCharges.pendingCharge.id}, reusing confirmation URL`
        );
        return res.json({
          success: true,
          charge: existingCharges.pendingCharge,
          confirmationUrl: existingCharges.pendingCharge.confirmation_url,
          existing: true,
        });
      }

      // If there's already an active charge, return success
      if (existingCharges.hasActiveCharge && existingCharges.activeCharge) {
        logger.info(
          `[Subscription] Store already has active charge ${existingCharges.activeCharge.id}`
        );
        await subscriptionService.activatePaidSubscription(
          shop,
          existingCharges.activeCharge.id,
          accessToken
        );
        return res.json({
          success: true,
          charge: existingCharges.activeCharge,
          message: "Subscription already active",
          alreadyActive: true,
        });
      }

      // No existing charges, create a new one
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
        const chargeCancelled = await shopifyBillingService.cancelCharge(
          shop,
          accessToken,
          chargeId
        );

        // Update local subscription state immediately after cancelling charge
        // This ensures grace period logic executes and clients see updated state
        // without waiting for the webhook (which may be delayed or fail)
        if (chargeCancelled) {
          await subscriptionService.cancelSubscription(shop);
        } else {
          // If charge cancellation failed, throw error to prevent inconsistent state
          throw new Error("Failed to cancel charge in Shopify");
        }
      } else {
        // Just downgrade if no charge ID
        await subscriptionService.cancelSubscription(shop);
      }

      // Return the updated subscription so client can determine if grace period or immediate downgrade
      const updatedSubscription = await subscriptionService.getSubscription(
        shop
      );
      res.json({ success: true, subscription: updatedSubscription });
    } catch (error) {
      logger.error("Error cancelling subscription:", error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
