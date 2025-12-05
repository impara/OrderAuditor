
import "dotenv/config";
import crypto from "crypto";

const port = process.env.PORT || 5000;
const url = `http://localhost:${port}/api/webhooks/shopify/orders/create`;
// Note: server/routes.ts uses shopifyService.verifyWebhook which typically uses SHOPIFY_API_SECRET for partner apps
const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET;

if (!secret) {
  console.error("Error: SHOPIFY_API_SECRET or SHOPIFY_WEBHOOK_SECRET not set in .env");
  process.exit(1);
}

const payload = {
  id: Math.floor(Math.random() * 1000000000),
  order_number: Math.floor(Math.random() * 10000),
  email: "test-async@example.com",
  created_at: new Date().toISOString(),
  total_price: "100.00",
  currency: "USD",
  line_items: [
    { id: 1, title: "Test Async Product", quantity: 1, price: "100.00" }
  ],
  customer: {
    id: 987654321,
    first_name: "Async",
    last_name: "Tester",
    email: "test-async@example.com"
  },
  name: "#ASYNC-TEST"
};

const rawBody = JSON.stringify(payload);
const hmac = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

console.log(`Sending webhook to ${url}...`);
console.log(`Using secret starting with: ${secret.substring(0, 4)}...`);

async function send() {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": "orders/create",
        "X-Shopify-Hmac-Sha256": hmac,
        "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
        "X-Shopify-Webhook-Id": "test-webhook-id-" + Date.now()
      },
      body: rawBody
    });

    const text = await res.text();
    console.log(`Response status: ${res.status}`);
    console.log(`Response body: ${text}`);
  } catch (err) {
    console.error("Failed to send webhook:", err);
  }
}

send();
