import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { duplicateDetectionService } from "./services/duplicate-detection.service";
import { shopifyService } from "./services/shopify.service";
import { insertOrderSchema, updateDetectionSettingsSchema } from "@shared/schema";
import { randomUUID } from "crypto";
import { requireAuth } from "./middleware/auth";
import bcrypt from "bcryptjs";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminPassword) {
        console.error("ADMIN_PASSWORD environment variable not set");
        return res.status(500).json({ error: "Server configuration error" });
      }

      if (!password) {
        return res.status(400).json({ error: "Password is required" });
      }

      // Compare password with hashed admin password
      // For initial setup, accept plain text comparison but warn
      let isValid = false;
      
      if (adminPassword.startsWith('$2')) {
        // Hashed password (bcrypt)
        isValid = await bcrypt.compare(password, adminPassword);
      } else {
        // Plain text password (for dev/initial setup)
        if (process.env.NODE_ENV === 'production') {
          console.warn("⚠️  WARNING: Using plain text ADMIN_PASSWORD in production! Use bcrypt hash instead.");
        }
        isValid = password === adminPassword;
      }

      if (!isValid) {
        return res.status(401).json({ error: "Invalid password" });
      }

      // Set session
      req.session.isAuthenticated = true;
      req.session.userId = "admin";

      res.json({ success: true, message: "Authenticated successfully" });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true, message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/check", (req: Request, res: Response) => {
    res.json({ 
      isAuthenticated: !!(req.session && req.session.isAuthenticated)
    });
  });

  // Health check endpoint (public, for monitoring)
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ 
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    });
  });

  // Protected admin routes - require authentication
  app.get("/api/dashboard/stats", requireAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/orders/flagged", requireAuth, async (_req: Request, res: Response) => {
    try {
      const orders = await storage.getFlaggedOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching flagged orders:", error);
      res.status(500).json({ error: "Failed to fetch flagged orders" });
    }
  });

  app.get("/api/settings", requireAuth, async (_req: Request, res: Response) => {
    try {
      let settings = await storage.getSettings();
      if (!settings) {
        settings = await storage.initializeSettings();
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedData = updateDetectionSettingsSchema.parse(req.body);
      const settings = await storage.updateSettings(validatedData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(400).json({ error: "Invalid settings data" });
    }
  });

  app.get("/api/webhooks/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      console.log("[API] Checking webhook registration status");
      const webhooks = await shopifyService.listWebhooks();
      
      const ordersWebhook = webhooks.find(wh => wh.topic === "orders/create");
      
      res.json({
        registered: !!ordersWebhook,
        webhook: ordersWebhook || null,
        totalWebhooks: webhooks.length,
        allWebhooks: webhooks,
      });
    } catch (error) {
      console.error("[API] Error checking webhook status:", error);
      res.status(500).json({ 
        error: "Failed to check webhook status",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/webhooks/register", requireAuth, async (_req: Request, res: Response) => {
    try {
      console.log("[API] Webhook registration requested");
      const result = await shopifyService.registerOrdersWebhook();
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error("[API] Error registering webhook:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to register webhook",
      });
    }
  });

  // Diagnostic endpoint to help troubleshoot webhook verification (protected)
  app.get("/api/webhooks/diagnostic", requireAuth, async (_req: Request, res: Response) => {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
    res.json({
      configured: {
        shopDomain: !!process.env.SHOPIFY_SHOP_DOMAIN,
        accessToken: !!process.env.SHOPIFY_ACCESS_TOKEN,
        webhookSecret: !!secret,
      },
      secretInfo: {
        length: secret.length,
        prefix: secret.substring(0, 6) + "...",
        startsWithShpss: secret.startsWith("shpss_"),
        startsWithShpat: secret.startsWith("shpat_"),
        expectedFormat: "Should be the 'API secret key' from Shopify app credentials (NOT the access token)",
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

  // Test endpoint removed - sensitive configuration data should not be exposed
  // For testing webhooks, use the Shopify Admin or external tools like Postman

  // Shopify webhook handler with route-specific raw body middleware
  app.post(
    "/api/webhooks/shopify/orders/create",
    express.raw({ type: 'application/json' }),
    async (req: any, res: Response) => {
      try {
        const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
        // With route-specific express.raw middleware, req.body is the raw Buffer
        const rawBody: Buffer = req.body;

      console.log("[Webhook] Received webhook");
      console.log("[Webhook] HMAC Header present:", !!hmacHeader);
      console.log("[Webhook] Raw body is Buffer:", Buffer.isBuffer(rawBody));
      console.log("[Webhook] Raw body length:", rawBody.length);

      // Verify HMAC signature using raw bytes
      if (!hmacHeader || !shopifyService.verifyWebhook(rawBody, hmacHeader)) {
        console.warn("[Webhook] Invalid webhook signature");
        console.warn("[Webhook] HMAC header:", hmacHeader);
        return res.status(401).json({ error: "Invalid webhook signature" });
      }

      console.log("[Webhook] ✅ Signature verified successfully!");

      // Parse JSON after verification
      const shopifyOrder = JSON.parse(rawBody.toString('utf8'));

      const orderData = {
        shopifyOrderId: shopifyOrder.id.toString(),
        orderNumber: shopifyOrder.order_number?.toString() || shopifyOrder.name,
        customerEmail: shopifyOrder.email || shopifyOrder.customer?.email || "unknown@example.com",
        customerName: (() => {
          const firstName = shopifyOrder.customer?.first_name || shopifyOrder.billing_address?.first_name || "";
          const lastName = shopifyOrder.customer?.last_name || shopifyOrder.billing_address?.last_name || "";
          if (firstName && lastName) {
            return `${firstName} ${lastName}`;
          } else if (firstName) {
            return firstName;
          } else if (lastName) {
            return lastName;
          }
          return null;
        })(),
        customerPhone: shopifyOrder.phone || shopifyOrder.customer?.phone || null,
        shippingAddress: shopifyOrder.shipping_address ? {
          address1: shopifyOrder.shipping_address.address1,
          address2: shopifyOrder.shipping_address.address2,
          city: shopifyOrder.shipping_address.city,
          province: shopifyOrder.shipping_address.province,
          country: shopifyOrder.shipping_address.country,
          zip: shopifyOrder.shipping_address.zip,
        } : null,
        totalPrice: shopifyOrder.total_price || "0.00",
        currency: shopifyOrder.currency || "USD",
        createdAt: new Date(shopifyOrder.created_at),
      };

      const validatedOrder = insertOrderSchema.parse(orderData);

      // Ensure detection settings are initialized
      let settings = await storage.getSettings();
      if (!settings) {
        settings = await storage.initializeSettings();
      }

      const duplicateMatch = await duplicateDetectionService.findDuplicates(validatedOrder);

      if (duplicateMatch) {
        const flaggedOrder = await storage.createOrder(validatedOrder);

        await storage.updateOrder(flaggedOrder.id, {
          isFlagged: true,
          flaggedAt: new Date(),
          duplicateOfOrderId: duplicateMatch.order.id,
          matchReason: duplicateMatch.matchReason,
          matchConfidence: duplicateMatch.confidence,
        });

        await storage.createAuditLog({
          orderId: flaggedOrder.id,
          action: "flagged",
          details: {
            duplicateOf: duplicateMatch.order.orderNumber,
            confidence: duplicateMatch.confidence,
            reason: duplicateMatch.matchReason,
          },
        });

        try {
          await shopifyService.tagOrder(shopifyOrder.id.toString(), ["duplicate-flagged"]);
          
          await storage.createAuditLog({
            orderId: flaggedOrder.id,
            action: "tagged",
            details: { tags: ["duplicate-flagged"] },
          });
        } catch (error) {
          console.error("Failed to tag order in Shopify:", error);
        }

        const updatedOrder = await storage.getOrder(flaggedOrder.id);
        res.json({ 
          success: true, 
          flagged: true,
          order: updatedOrder,
        });
      } else {
        const order = await storage.createOrder(validatedOrder);
        res.json({ 
          success: true, 
          flagged: false,
          order,
        });
      }
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

  const httpServer = createServer(app);

  return httpServer;
}
