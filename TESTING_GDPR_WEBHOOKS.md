# Testing GDPR Compliance Webhooks Locally

This guide shows you how to test the three mandatory GDPR compliance webhooks locally using Shopify CLI.

## Prerequisites

1. **Environment Variables**:

   - For **Partner Apps**: Set `SHOPIFY_API_SECRET` (Client Secret from Partner Dashboard)
   - For **Legacy Custom Apps**: Set `SHOPIFY_WEBHOOK_SECRET`
   - The test script will use `SHOPIFY_API_SECRET` if available, falling back to `SHOPIFY_WEBHOOK_SECRET`

2. **Shopify CLI installed** (optional):

   ```bash
   npm install -g @shopify/cli @shopify/theme
   ```

3. **Your app running locally** with ngrok or similar tunnel:

   ```bash
   # Terminal 1: Start your app
   npm run dev

   # Terminal 2: Start ngrok
   ngrok http 5000
   ```

4. **Update `.env`** with your ngrok URL:

   ```env
   APP_URL=https://your-ngrok-url.ngrok.io
   ```

5. **Register webhooks** (including compliance webhooks):
   ```bash
   curl -X POST http://localhost:5000/api/webhooks/register
   ```

## Testing with Shopify CLI

### 1. Test `customers/data_request` Webhook

This webhook is triggered when a customer requests their data.

```bash
shopify app trigger webhook \
  --topic customers/data_request \
  --api-version 2024-07 \
  --delivery-method http \
  --shared-secret YOUR_WEBHOOK_SECRET
```

**Or use a test payload file:**

Create `test-payloads/customers-data-request.json`:

```json
{
  "shop_id": 954889,
  "shop_domain": "your-store.myshopify.com",
  "orders_requested": [299938, 280263, 220458],
  "customer": {
    "id": 191167,
    "email": "john@example.com",
    "phone": "555-625-1199"
  },
  "data_request": {
    "id": 9999
  }
}
```

Then trigger:

```bash
shopify app trigger webhook \
  --topic customers/data_request \
  --api-version 2024-07 \
  --delivery-method http \
  --shared-secret YOUR_WEBHOOK_SECRET \
  --data-file test-payloads/customers-data-request.json
```

**Expected behavior:**

- Webhook should return `200 OK`
- Check logs for: "Data request for customer: john@example.com"
- Check database for customer orders matching that email

### 2. Test `customers/redact` Webhook

This webhook is triggered when a customer requests data deletion.

```bash
shopify app trigger webhook \
  --topic customers/redact \
  --api-version 2024-07 \
  --delivery-method http \
  --shared-secret YOUR_WEBHOOK_SECRET
```

**Test payload file `test-payloads/customers-redact.json`:**

```json
{
  "shop_id": 954889,
  "shop_domain": "your-store.myshopify.com",
  "customer": {
    "id": 191167,
    "email": "john@example.com",
    "phone": "555-625-1199"
  },
  "orders_to_redact": [299938, 280263, 220458]
}
```

**Test cases to verify:**

1. **With specific order IDs:**

   ```json
   {
     "orders_to_redact": [299938, 280263]
   }
   ```

   - Should redact only those specific orders

2. **With empty array (no orders to redact):**

   ```json
   {
     "orders_to_redact": []
   }
   ```

   - Should NOT redact any orders (early return)

3. **With null (redact all orders):**

   ```json
   {
     "orders_to_redact": null
   }
   ```

   - Should redact all orders for the customer

4. **With undefined/missing field (redact all orders):**
   ```json
   {
     "customer": { "email": "john@example.com" }
   }
   ```
   - Should redact all orders for the customer

**Expected behavior:**

- Webhook should return `200 OK`
- Check logs for: "Successfully redacted customer data"
- Verify in database that customer data is anonymized:
  - `customerEmail` → "redacted@example.com"
  - `customerName` → "Redacted"
  - `customerPhone` → `null`
  - `shippingAddress` → `null`

### 3. Test `shop/redact` Webhook

This webhook is triggered 48 hours after app uninstall.

```bash
shopify app trigger webhook \
  --topic shop/redact \
  --api-version 2024-07 \
  --delivery-method http \
  --shared-secret YOUR_WEBHOOK_SECRET
```

**Test payload file `test-payloads/shop-redact.json`:**

```json
{
  "shop_id": 954889,
  "shop_domain": "your-store.myshopify.com"
}
```

**Expected behavior:**

- Webhook should return `200 OK`
- Check logs for: "Successfully cleaned up all data for shop"
- Verify in database that all shop data is deleted:
  - All orders for the shop
  - All audit logs
  - All settings
  - All subscriptions
  - All webhook deliveries (except the current one for idempotency)

## Testing Duplicate Detection

To verify that duplicate webhook deliveries are handled correctly:

1. **Trigger the same webhook twice** with the same delivery ID
2. **Expected behavior:**
   - First call: Processes normally
   - Second call: Returns immediately with `"duplicate": true` message
   - Check logs for: "Duplicate [webhook] webhook detected"

## Manual Testing with curl

If you prefer to test manually with curl (useful for debugging):

### 1. Generate HMAC signature

You'll need to create a valid HMAC signature. Here's a Node.js script to help:

```javascript
// generate-hmac.js
const crypto = require("crypto");

// For Partner Apps: Use SHOPIFY_API_SECRET
// For Legacy Custom Apps: Use SHOPIFY_WEBHOOK_SECRET
const secret =
  process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET;
const payload = JSON.stringify({
  shop_id: 954889,
  shop_domain: "your-store.myshopify.com",
  customer: {
    email: "john@example.com",
  },
  orders_to_redact: [],
});

const hmac = crypto
  .createHmac("sha256", secret)
  .update(payload, "utf8")
  .digest("base64");

console.log("HMAC:", hmac);
console.log("Payload:", payload);
```

Run it:

```bash
node generate-hmac.js
```

### 2. Send test webhook with curl

```bash
curl -X POST https://your-ngrok-url.ngrok.io/api/webhooks/shopify/customers/redact \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: YOUR_HMAC_HERE" \
  -H "X-Shopify-Topic: customers/redact" \
  -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
  -H "X-Shopify-Delivery-Id: test-delivery-123" \
  -d @test-payloads/customers-redact.json
```

## Verification Checklist

After testing each webhook, verify:

- [ ] Webhook returns `200 OK` status
- [ ] No errors in application logs
- [ ] HMAC signature verification works (try with invalid signature - should return `401`)
- [ ] Duplicate detection works (same delivery ID twice)
- [ ] Database changes are correct:
  - [ ] `customers/data_request`: Orders are retrieved correctly
  - [ ] `customers/redact`: Customer data is anonymized correctly
  - [ ] `shop/redact`: All shop data is deleted
- [ ] Empty array handling works (`orders_to_redact: []` doesn't redact all)
- [ ] Null handling works (`orders_to_redact: null` is normalized correctly)

## Troubleshooting

### Webhook not received

1. **Check ngrok is running** and URL is correct in `.env`
2. **Verify webhook is registered:**
   ```bash
   curl http://localhost:5000/api/webhooks/status
   ```
3. **Check ngrok web interface** at http://127.0.0.1:4040 to see incoming requests

### HMAC verification fails

1. **Verify the correct secret** in `.env`:
   - For **Partner Apps**: `SHOPIFY_API_SECRET` should match your app's Client Secret from Partner Dashboard
   - For **Legacy Custom Apps**: `SHOPIFY_WEBHOOK_SECRET` should match your app's webhook secret
2. **Check the payload** matches exactly (no extra whitespace, correct encoding)
3. **Verify HMAC calculation** uses the raw body bytes, not parsed JSON

### Database not updating

1. **Check database connection** in `.env`
2. **Verify database schema** is up to date:
   ```bash
   npm run db:push
   ```
3. **Check application logs** for database errors

## Next Steps

Once local testing passes:

1. **Test in development store** with real Shopify webhooks
2. **Submit for app review** - Shopify will test compliance webhooks
3. **Monitor production logs** after deployment
