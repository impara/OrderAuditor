import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { duplicateDetectionService } from "./services/duplicate-detection.service";
import { shopifyService } from "./services/shopify.service";
import { insertOrderSchema, updateDetectionSettingsSchema } from "@shared/schema";
import { randomUUID } from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(express.json({ 
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    }
  }));

  app.get("/api/dashboard/stats", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/orders/flagged", async (_req: Request, res: Response) => {
    try {
      const orders = await storage.getFlaggedOrders();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching flagged orders:", error);
      res.status(500).json({ error: "Failed to fetch flagged orders" });
    }
  });

  app.get("/api/settings", async (_req: Request, res: Response) => {
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

  app.patch("/api/settings", async (req: Request, res: Response) => {
    try {
      const validatedData = updateDetectionSettingsSchema.parse(req.body);
      const settings = await storage.updateSettings(validatedData);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(400).json({ error: "Invalid settings data" });
    }
  });

  app.get("/api/webhooks/status", async (_req: Request, res: Response) => {
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

  app.post("/api/webhooks/register", async (_req: Request, res: Response) => {
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

  // Diagnostic endpoint to help troubleshoot webhook verification
  app.get("/api/webhooks/diagnostic", async (_req: Request, res: Response) => {
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

  app.post("/api/webhooks/test", async (req: any, res: Response) => {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    
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
        wouldVerify: hmacHeader ? shopifyService.verifyWebhook(rawBody, hmacHeader) : false,
      },
    });
  });

  app.post("/api/webhooks/shopify/orders/create", async (req: any, res: Response) => {
    try {
      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      // With express.raw middleware, req.body is the raw Buffer
      const rawBody: Buffer = req.body;

      console.log("[Webhook] Received webhook");
      console.log("[Webhook] HMAC Header present:", !!hmacHeader);
      console.log("[Webhook] Raw body is Buffer:", Buffer.isBuffer(rawBody));
      console.log("[Webhook] Raw body length:", rawBody.length);

      // Verify HMAC signature using raw bytes
      if (!hmacHeader) {
        console.error("[Webhook] ❌ Missing HMAC header");
        console.error("[Webhook] Request headers:", JSON.stringify(req.headers, null, 2));
        return res.status(401).json({ error: "Missing webhook signature header" });
      }
      
      if (!shopifyService.verifyWebhook(rawBody, hmacHeader)) {
        console.warn("[Webhook] ❌ Invalid webhook signature");
        console.warn("[Webhook] HMAC header:", hmacHeader);
        console.warn("[Webhook] Body preview (first 200 chars):", rawBody.toString('utf8').substring(0, 200));
        console.warn("[Webhook] Possible causes:");
        console.warn("  1. Webhook secret mismatch - check SHOPIFY_WEBHOOK_SECRET in .env");
        console.warn("  2. Request body was modified (ngrok free tier can do this)");
        console.warn("  3. Using wrong webhook secret (should be 'API secret key', not 'Admin API access token')");
        return res.status(401).json({ error: "Invalid webhook signature" });
      }

      console.log("[Webhook] ✅ Signature verified successfully!");

      // Parse JSON after verification
      const shopifyOrder = JSON.parse(rawBody.toString('utf8'));

      // DUMP FULL PAYLOAD for analysis - save to file for inspection
      const payloadDump = {
        timestamp: new Date().toISOString(),
        orderId: shopifyOrder.id,
        orderNumber: shopifyOrder.order_number,
        // Top-level fields
        topLevelFields: Object.keys(shopifyOrder),
        email: shopifyOrder.email,
        contact_email: shopifyOrder.contact_email,
        // Customer object (full)
        customer: shopifyOrder.customer,
        customerKeys: shopifyOrder.customer ? Object.keys(shopifyOrder.customer) : null,
        // Addresses
        shipping_address: shopifyOrder.shipping_address,
        billing_address: shopifyOrder.billing_address,
        // Full payload (truncated for logs, but we'll save it)
        fullPayload: shopifyOrder,
      };
      
      // Log FULL payload structure - save complete JSON for analysis
      console.log("[Webhook] ========== FULL WEBHOOK PAYLOAD ==========");
      console.log("[Webhook] Order ID:", shopifyOrder.id);
      console.log("[Webhook] Order Number:", shopifyOrder.order_number);
      console.log("[Webhook] Top-level keys:", Object.keys(shopifyOrder));
      console.log("[Webhook] Full payload JSON (first 3000 chars):", JSON.stringify(shopifyOrder, null, 2).substring(0, 3000));
      console.log("[Webhook] ===========================================");
      
      // Log the actual customer, shipping_address, and billing_address objects
      console.log("[Webhook] Customer object:", JSON.stringify(shopifyOrder.customer, null, 2));
      console.log("[Webhook] Shipping address:", JSON.stringify(shopifyOrder.shipping_address, null, 2));
      console.log("[Webhook] Billing address:", JSON.stringify(shopifyOrder.billing_address, null, 2));
      
      // Check if we need to fetch customer details via API
      // Shopify webhooks may not include customer email/name due to Protected Customer Data Access restrictions
      // Note: API access to PII requires Shopify/Advanced/Plus plan (not available on Basic/Free plans)
      // The customer object exists but lacks email/name fields - fetch customer separately
      let customerData = shopifyOrder.customer;
      if (shopifyOrder.customer?.id && !shopifyOrder.customer?.email && !shopifyOrder.email) {
        console.log("[Webhook] ⚠️ Customer email not in webhook payload, attempting to fetch customer via API...");
        console.log("[Webhook] Note: This requires Protected Customer Data Access + Shopify/Advanced/Plus plan");
        const apiCustomer = await shopifyService.getCustomer(shopifyOrder.customer.id);
        if (apiCustomer && apiCustomer.email) {
          console.log("[Webhook] ✅ Successfully fetched customer via API");
          console.log("[Webhook] API Customer email:", apiCustomer.email);
          console.log("[Webhook] API Customer name:", apiCustomer.first_name, apiCustomer.last_name);
          customerData = apiCustomer;
        } else {
          console.log("[Webhook] ⚠️ Customer API fetch failed or returned no email");
          console.log("[Webhook] Possible reasons:");
          console.log("[Webhook]   1. Protected Customer Data Access not enabled");
          console.log("[Webhook]   2. App lacks read_customers scope");
          console.log("[Webhook]   3. Store is on Basic/Free plan (PII access requires Shopify/Advanced/Plus)");
          console.log("[Webhook]   4. Merchant hasn't approved Protected Customer Data Access request");
        }
      }
      
      // Use webhook order data
      const fullOrder = shopifyOrder;

      // Extract customer email from multiple possible locations
      // Use customerData (may be fetched via API if webhook lacks data)
      const customerEmail = 
        fullOrder.email || 
        fullOrder.contact_email ||
        customerData?.email ||
        fullOrder.shipping_address?.email ||
        fullOrder.billing_address?.email ||
        customerData?.default_address?.email ||
        null;

      // Extract customer name with better fallbacks
      // Use customerData (may be fetched via API if webhook lacks data)
      const customerName = (() => {
        // Try customerData first (fetched via API if needed)
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
        
        // Fallback to customer name field
        if (customerData?.name) {
          return customerData.name;
        }
        
        // Fallback to shipping_address name field
        if (fullOrder.shipping_address?.name) {
          return fullOrder.shipping_address.name;
        }
        
        // Fallback to default_address name
        if (customerData?.default_address?.name) {
          return customerData.default_address.name;
        }
        
        return null;
      })();

      // Extract customer phone
      // Use customerData (may be fetched via API if webhook lacks data)
      const customerPhone = 
        fullOrder.phone ||
        customerData?.phone ||
        fullOrder.shipping_address?.phone ||
        fullOrder.billing_address?.phone ||
        customerData?.default_address?.phone ||
        null;

      // Log extracted data for debugging
      console.log("[Webhook] Extracted customer data:", {
        email: customerEmail || "NOT FOUND",
        name: customerName || "NOT FOUND",
        phone: customerPhone || "NOT FOUND",
        hasCustomer: !!fullOrder.customer,
        hasDefaultAddress: !!fullOrder.customer?.default_address,
        defaultAddressKeys: fullOrder.customer?.default_address ? Object.keys(fullOrder.customer.default_address) : [],
        fetchedViaAPI: fullOrder !== shopifyOrder,
      });

      const orderData = {
        shopifyOrderId: fullOrder.id.toString(),
        orderNumber: fullOrder.order_number?.toString() || fullOrder.name,
        customerEmail: customerEmail || "unknown@example.com",
        customerName,
        customerPhone,
        shippingAddress: fullOrder.shipping_address ? {
          address1: fullOrder.shipping_address.address1,
          address2: fullOrder.shipping_address.address2,
          city: fullOrder.shipping_address.city,
          province: fullOrder.shipping_address.province,
          country: fullOrder.shipping_address.country,
          zip: fullOrder.shipping_address.zip,
        } : null,
        totalPrice: fullOrder.total_price || "0.00",
        currency: fullOrder.currency || "USD",
        createdAt: new Date(fullOrder.created_at),
      };

      const validatedOrder = insertOrderSchema.parse(orderData);

      // Check if order already exists (webhook retries can cause duplicates)
      const existingOrder = await storage.getOrderByShopifyId(validatedOrder.shopifyOrderId);
      if (existingOrder) {
        console.log(`[Webhook] Order ${validatedOrder.shopifyOrderId} already exists, skipping duplicate processing`);
        return res.json({ 
          success: true, 
          flagged: existingOrder.isFlagged,
          order: existingOrder,
          message: "Order already processed",
        });
      }

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
          await shopifyService.tagOrder(fullOrder.id.toString(), ["duplicate-flagged"]);
          
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
  });

  const httpServer = createServer(app);

  return httpServer;
}
