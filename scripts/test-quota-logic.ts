
import "dotenv/config";
import crypto from "crypto";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { subscriptions, shopifySessions, orders, detectionSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

// Configuration
const SHOP_DOMAIN = "test-quota-shop.myshopify.com";
const WEBHOOK_URL = `http://localhost:${process.env.PORT || 5000}/api/webhooks/shopify/orders/create`;
const SECRET = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || "test_secret";

// Test Data
const ORDER_A = {
  id: 1001,
  order_number: 1001,
  email: "customer@example.com",
  created_at: new Date().toISOString(),
  total_price: "50.00",
  currency: "USD",
  line_items: [{ id: 1, title: "Item A", quantity: 1, price: "50.00", sku: "SKU123" }],
  customer: { id: 1, first_name: "John", last_name: "Doe", email: "customer@example.com" },
  name: "#1001"
};

const ORDER_B = {
  ...ORDER_A,
  id: 1002,
  order_number: 1002,
  total_price: "60.00",
  name: "#1002"
};

// Helper to send webhook
async function sendWebhook(order: any) {
  const rawBody = JSON.stringify(order);
  const hmac = crypto.createHmac("sha256", SECRET).update(rawBody, "utf8").digest("base64");
  
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Shop-Domain": SHOP_DOMAIN,
        "X-Shopify-Webhook-Id": `test-hook-${Date.now()}`
      },
      body: rawBody
    });
    console.log(`Webhook sent for order ${order.order_number}. Status: ${res.status}`);
    return res;
  } catch (err) {
    console.error("Webhook failed:", err);
  }
}

async function setup() {
  console.log("Setting up test data...");
  
  // 1. Clear existing data for test shop
  try {
    await db.delete(orders).where(eq(orders.shopDomain, SHOP_DOMAIN));
    await db.delete(subscriptions).where(eq(subscriptions.shopifyShopDomain, SHOP_DOMAIN));
    await db.delete(shopifySessions).where(eq(shopifySessions.shop, SHOP_DOMAIN));
    await db.delete(detectionSettings).where(eq(detectionSettings.shopDomain, SHOP_DOMAIN));
  } catch (e) {
    console.log("Error clearing data (tables might be empty/missing):", e);
  }

  // 2. Create session (needed for notification service to find email)
  const sessionData = {
    id: `offline_${SHOP_DOMAIN}`,
    shop: SHOP_DOMAIN,
    state: "test_state",
    isOnline: false,
    scope: "read_orders",
    accessToken: "test_token",
    email: "admin@test-quota-shop.com" // Crucial for notification test
  };
  
  await db.insert(shopifySessions).values(sessionData);

  // 3. Create Subscription (Free Tier - 30 limit)
  await storage.initializeSubscription(SHOP_DOMAIN);

  // 4. Create Detection Settings
  await db.insert(detectionSettings).values({
    shopDomain: SHOP_DOMAIN,
    matchEmail: true,
    timeWindowHours: 24,
    enableNotifications: true // useful for debugging
  });
  
  console.log("Setup complete. Subscription created with limit 30. Settings initialized.");
}

async function runTest() {
  await setup();

  // --- Step 1: Send Unique Order ---
  console.log("\n--- Step 1: Sending Order A (Unique) ---");
  await sendWebhook(ORDER_A);
  
  // Wait for processing
  await new Promise(r => setTimeout(r, 2000));
  
  let sub = await storage.getSubscription(SHOP_DOMAIN);
  console.log(`Count after Order A: ${sub?.monthlyOrderCount} (Expected: 0 if no dupes found yet, or 0 if counting only dups)`);
  
  if (sub?.monthlyOrderCount !== 0) {
      console.error("FAILED: Count should be 0 for first unique order.");
  } else {
      console.log("PASSED: Count is 0 for unique order.");
  }

  // DEBUG: Check if Order A was saved
  const savedOrders = await db.select().from(orders).where(eq(orders.shopDomain, SHOP_DOMAIN));
  console.log(`DEBUG: Saved orders count: ${savedOrders.length}`);
  if (savedOrders.length > 0) {
      console.log(`DEBUG: Last order ID: ${savedOrders[0].shopifyOrderId}`);
  } else {
      console.error("DEBUG: Order A was NOT saved to DB! Webhook processing likely failed.");
  }

  // --- Step 2: Send Duplicate Order ---
  console.log("\n--- Step 2: Sending Order B (Duplicate of A) ---");
  await sendWebhook(ORDER_B);
  
  await new Promise(r => setTimeout(r, 2000));
  
  sub = await storage.getSubscription(SHOP_DOMAIN);
  console.log(`Count after Order B: ${sub?.monthlyOrderCount} (Expected: 1)`);

  if (sub?.monthlyOrderCount !== 1) {
      console.error("FAILED: Count should be 1 after duplicate.");
  } else {
      console.log("PASSED: Count incremented for duplicate.");
  }

  // --- Step 3: Test Quota Exceeded Notification ---
  console.log("\n--- Step 3: Triggering Quota Limit (30) ---");
  
  // DEBUG: Check Session
  const sessions = await db.select().from(shopifySessions).where(eq(shopifySessions.shop, SHOP_DOMAIN));
  console.log(`DEBUG: Sessions found: ${sessions.length}`);
  if (sessions.length > 0) {
      console.log(`DEBUG: Session[0]:`, sessions[0]);
  }

  // Manually bump count to 29
  await storage.updateSubscription(SHOP_DOMAIN, { monthlyOrderCount: 29 });
  
  // Send another duplicate
  const ORDER_C = {
      ...ORDER_A,
      id: 1003,
      order_number: 1003,
      created_at: new Date().toISOString(), // Fresh time
      name: "#1003"
  };
  await sendWebhook(ORDER_C);
  
  await new Promise(r => setTimeout(r, 2000));
  
  sub = await storage.getSubscription(SHOP_DOMAIN);
  console.log(`Count after Order C: ${sub?.monthlyOrderCount} (Expected: 30)`);
  console.log(`Notified At: ${sub?.quotaExceededNotifiedAt}`);

  if (sub?.monthlyOrderCount === 30 && sub?.quotaExceededNotifiedAt) {
      console.log("PASSED: Limit reached and notification date set.");
  } else {
      console.error("FAILED: Limit not reached or notification not set.");
  }

  // --- Step 4: Exceed Limit (Spam Prevention) ---
  console.log("\n--- Step 4: Exceeding Limit (31) ---");
  const ORDER_D = {
      ...ORDER_A,
      id: 1004,
      order_number: 1004,
      created_at: new Date().toISOString(),
      name: "#1004"
  };
  
  // Capture existing notification time
  const existingNotifyTime = sub?.quotaExceededNotifiedAt?.getTime();
  
  await sendWebhook(ORDER_D);
  await new Promise(r => setTimeout(r, 2000));
  
  sub = await storage.getSubscription(SHOP_DOMAIN);
  const newNotifyTime = sub?.quotaExceededNotifiedAt?.getTime();
  
  console.log(`Count: ${sub?.monthlyOrderCount} (Expected: 31)`);
  
  if (existingNotifyTime && existingNotifyTime === newNotifyTime) {
      console.log("PASSED: Notification timestamp unchanged (Spam prevention working).");
  } else {
      console.error("FAILED: Notification timestamp changed or missing!");
  }

  console.log("\nTest Completed.");
  process.exit(0);
}

runTest().catch(console.error);
