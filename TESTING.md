# Testing Guide - Validation Plan Implementation

This guide helps you test all the features implemented from the validation plan.

## Quick Start

### ✅ Verified Working

1. **Database Schema**: Subscriptions table exists with correct structure
2. **Subscription Endpoint**: `/api/subscription` returns subscription data
3. **Server Running**: API is accessible at http://localhost:5000

### Quick Tests to Run

#### 1. Test Subscription System (30 seconds)

```bash
# Check subscription status
curl http://localhost:5000/api/subscription | jq '.'

# Should show:
# - tier: "free"
# - orderLimit: 50
# - monthlyOrderCount: 0
```

#### 2. Test ReturnUrl Security (30 seconds)

```bash
# Test malicious URL rejection
curl -X POST http://localhost:5000/api/subscription/upgrade \
  -H "Content-Type: application/json" \
  -d '{"returnUrl": "https://evil.com/phishing"}'

# Check server logs - should see:
# [Security] Invalid returnUrl rejected: https://evil.com/phishing
```

#### 3. Test Notification Settings (30 seconds)

```bash
# Enable notifications
curl -X PATCH http://localhost:5000/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "enableNotifications": true,
    "notificationThreshold": 80,
    "slackWebhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
  }'

# Verify it saved
curl http://localhost:5000/api/settings | jq '.enableNotifications'
# Should return: true
```

#### 4. Test Order Tag Name (1 minute)

1. Create a test duplicate order:

   ```bash
   npm run test:duplicate
   ```

2. Check Shopify admin - the order should have tag: **"Merge_Review_Candidate"**

3. Check database audit logs:
   ```sql
   SELECT details FROM audit_logs WHERE action = 'tagged' ORDER BY performed_at DESC LIMIT 1;
   ```
   Should show: `{"tags": ["Merge_Review_Candidate"]}`

#### 5. Test Quota Enforcement (2 minutes)

```bash
# Manually set order count to limit
docker-compose exec postgres psql -U orderauditor -d orderauditor -c \
  "UPDATE subscriptions SET monthly_order_count = 50 WHERE shopify_shop_domain = 'yourstore.myshopify.com';"

# Try to process an order (via webhook or test script)
# Should return 403 with QUOTA_EXCEEDED error
```

#### 6. Test Subscription UI (1 minute)

1. Start dev server: `npm run dev`
2. Navigate to: http://localhost:5000/subscription
3. Verify you see:
   - Current plan (Free)
   - Usage: 0/50 orders
   - Upgrade button
   - Plan comparison

### Automated Test Script

Run the automated test suite:

```bash
npm run test:validation
```

Or manually:

```bash
./scripts/test-validation-plan.sh
```

### What's Working

✅ Subscription table created  
✅ Subscription endpoint working  
✅ Quota checking implemented  
✅ ReturnUrl validation (security)  
✅ Order tag name updated to "Merge_Review_Candidate"  
✅ Notification settings structure in place

### What Needs Configuration

⚠️ **Email Notifications**: Requires SMTP setup or email service integration  
⚠️ **Slack Notifications**: Requires valid Slack webhook URL  
⚠️ **Shopify Billing**: Requires Shopify app with billing permissions (for upgrade flow)

### Next Steps

1. Test with real duplicate orders
2. Configure Slack webhook for notifications
3. Test upgrade flow with Shopify (requires Shopify Partner account)
4. Monitor quota enforcement in production

---

## Prerequisites

1. Database schema is pushed: `npm run db:push`
2. Database is running: `docker-compose ps` shows postgres as healthy
3. Environment variables are configured in `.env`
4. Development server can be started: `npm run dev`

## Test Checklist

### Phase 1: Order Tag Name Fix ✅

**Test**: Verify orders are tagged with "Merge_Review_Candidate" instead of "duplicate-flagged"

**Steps**:

1. Create a duplicate order (see scripts/README.md)
2. Check Shopify admin to verify the order has tag "Merge_Review_Candidate"
3. Check audit logs in database to verify tag name

**Expected Result**: Orders flagged as duplicates should have the tag "Merge_Review_Candidate" in Shopify

---

### Phase 2: Notification Service ✅

**Test 1: Slack Notifications**

**Setup**:

1. Get a Slack webhook URL from your Slack workspace
2. Update settings via UI or API:
   ```bash
   curl -X PATCH http://localhost:5000/api/settings \
     -H "Content-Type: application/json" \
     -d '{
       "enableNotifications": true,
       "slackWebhookUrl": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
       "notificationThreshold": 70
     }'
   ```

**Steps**:

1. Create a duplicate order that matches with confidence >= 70%
2. Check Slack channel for notification

**Expected Result**: Slack message appears with order details

---

**Test 2: Email Notifications**

**Setup**:

1. Configure SMTP in `.env`:

   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM=your-email@gmail.com
   ```

2. Update settings:
   ```bash
   curl -X PATCH http://localhost:5000/api/settings \
     -H "Content-Type: application/json" \
     -d '{
       "enableNotifications": true,
       "notificationEmail": "recipient@example.com",
       "notificationThreshold": 70
     }'
   ```

**Note**: Email sending requires nodemailer or similar. Currently logs a warning.

**Expected Result**: Email is sent (or logged if not fully implemented)

---

**Test 3: Notification Threshold**

**Steps**:

1. Set threshold to 90%:
   ```bash
   curl -X PATCH http://localhost:5000/api/settings \
     -H "Content-Type: application/json" \
     -d '{"notificationThreshold": 90}'
   ```
2. Create duplicate with 75% confidence
3. Create duplicate with 95% confidence

**Expected Result**: Only the 95% confidence duplicate triggers notification

---

### Phase 3: Subscription & Pricing System ✅

**Test 1: Free Tier Quota (50 orders/month)**

**Steps**:

1. Check current subscription:
   ```bash
   curl http://localhost:5000/api/subscription
   ```
2. Verify it shows `tier: "free"` and `orderLimit: 50`
3. Process 50 orders (or simulate by updating database)
4. Try to process 51st order via webhook

**Expected Result**:

- First 50 orders process successfully
- 51st order returns 403 with "QUOTA_EXCEEDED" error

---

**Test 2: Subscription UI**

**Steps**:

1. Start dev server: `npm run dev`
2. Navigate to `http://localhost:5000/subscription`
3. Verify it shows:
   - Current plan (Free)
   - Usage statistics
   - Plan comparison
   - Upgrade button

**Expected Result**: Subscription page loads and displays current usage

---

**Test 3: Upgrade Flow (Shopify Billing)**

**Steps**:

1. Click "Upgrade to Unlimited" button
2. Verify it creates a Shopify charge
3. Complete the Shopify billing flow
4. Verify subscription tier changes to "paid"

**Expected Result**:

- Charge is created in Shopify
- After approval, subscription upgrades to paid tier
- Order limit becomes -1 (unlimited)

---

**Test 4: Quota Enforcement**

**Steps**:

1. Set subscription to free tier with 50 order limit
2. Manually set `monthlyOrderCount` to 50 in database:
   ```sql
   UPDATE subscriptions SET monthly_order_count = 50 WHERE shopify_shop_domain = 'yourstore.myshopify.com';
   ```
3. Send a test webhook for a new order

**Expected Result**: Webhook returns 403 with quota exceeded message

---

**Test 5: Monthly Reset**

**Steps**:

1. Set billing period end to past date:
   ```sql
   UPDATE subscriptions
   SET current_billing_period_end = NOW() - INTERVAL '1 day'
   WHERE shopify_shop_domain = 'yourstore.myshopify.com';
   ```
2. Process a new order
3. Check subscription - order count should reset to 0

**Expected Result**: Order count resets when billing period expires

---

### Security: ReturnUrl Validation ✅

**Test: Open Redirect Prevention**

**Steps**:

1. Try to upgrade with malicious returnUrl:
   ```bash
   curl -X POST http://localhost:5000/api/subscription/upgrade \
     -H "Content-Type: application/json" \
     -d '{"returnUrl": "https://evil.com/phishing"}'
   ```
2. Check logs for security warning
3. Verify the actual returnUrl used is the safe default

**Expected Result**:

- Malicious URL is rejected
- Safe default URL is used instead
- Security warning is logged

---

**Test: Valid ReturnUrl**

**Steps**:

1. Use relative path:
   ```bash
   curl -X POST http://localhost:5000/api/subscription/upgrade \
     -H "Content-Type: application/json" \
     -d '{"returnUrl": "/subscription?upgrade=success"}'
   ```
2. Use same-domain URL:
   ```bash
   curl -X POST http://localhost:5000/api/subscription/upgrade \
     -H "Content-Type: application/json" \
     -d '{"returnUrl": "http://localhost:5000/subscription?upgrade=success"}'
   ```

**Expected Result**: Valid URLs are accepted and used

---

## Quick Test Script

Run this to test basic functionality:

```bash
# 1. Check subscription endpoint
curl http://localhost:5000/api/subscription

# 2. Check settings endpoint
curl http://localhost:5000/api/settings

# 3. Test quota check (should work if under limit)
# (This happens automatically when processing webhooks)

# 4. Test returnUrl validation
curl -X POST http://localhost:5000/api/subscription/upgrade \
  -H "Content-Type: application/json" \
  -d '{"returnUrl": "https://evil.com"}'
# Should use safe default, check server logs
```

## Database Verification

Check that subscription table exists and has correct schema:

```sql
-- Connect to database
psql postgresql://orderauditor:orderauditor@localhost:5432/orderauditor

-- Check subscriptions table
\d subscriptions

-- Check if subscription exists for your shop
SELECT * FROM subscriptions WHERE shopify_shop_domain = 'yourstore.myshopify.com';
```

## Troubleshooting

### Subscription not found

- Subscription is auto-created on first webhook
- Or manually initialize: The system auto-creates on first quota check

### Quota not enforced

- Check that `subscriptionService.checkQuota()` is called in webhook handler
- Verify subscription exists in database
- Check server logs for quota check results

### Notifications not sending

- Verify `enableNotifications` is true in settings
- Check confidence meets threshold
- For Slack: Verify webhook URL is correct
- For Email: Check SMTP configuration (may need nodemailer)

### Tag name wrong

- Check `server/routes.ts` line ~402 for tag array
- Should be `["Merge_Review_Candidate"]`

---

## Phase 4: Order Resolution & Dismissal ✅

**Test 1: Manual Dismissal from Dashboard**

**Steps**:

1. Start dev server: `npm run dev`
2. Navigate to dashboard: `http://localhost:5000`
3. Ensure you have at least one flagged order in the list
4. Click "View Details" on a flagged order
5. Click "Dismiss Order" button
6. Confirm dismissal in the dialog
7. Verify:
   - Order disappears from flagged orders list
   - Toast notification appears confirming dismissal
   - Check Shopify admin - "Merge_Review_Candidate" tag should be removed
   - Check database: `isFlagged` should be `false`, `resolvedAt` should be set, `resolvedBy` should be `'manual_dashboard'`

**Expected Result**:

- Order is removed from dashboard
- Tag is removed from Shopify
- Order data is preserved in database with resolution info
- Audit log entry created with action 'dismissed'

**Database Verification**:

```sql
-- Check resolved order
SELECT id, order_number, is_flagged, resolved_at, resolved_by
FROM orders
WHERE is_flagged = false
ORDER BY resolved_at DESC
LIMIT 5;

-- Check audit logs
SELECT * FROM audit_logs
WHERE action IN ('dismissed', 'resolved')
ORDER BY performed_at DESC
LIMIT 5;
```

---

**Test 2: Automatic Resolution via Shopify Tag Removal**

**Prerequisites**:

- Ensure `orders/updated` webhook is registered (check with `GET /api/webhooks/status`)
- Have at least one flagged order in the system

**Steps**:

1. Find a flagged order in Shopify admin (should have "Merge_Review_Candidate" tag)
2. Remove the "Merge_Review_Candidate" tag from the order in Shopify admin
3. Wait a few seconds for webhook to process
4. Refresh the dashboard
5. Verify:
   - Order disappears from flagged orders list
   - Check database: `isFlagged` should be `false`, `resolvedAt` should be set, `resolvedBy` should be `'shopify_tag_removed'`
   - Check audit logs: entry with action 'resolved' should exist

**Expected Result**:

- Order automatically resolves when tag is removed in Shopify
- No manual action needed in dashboard
- Full audit trail maintained

**Webhook Verification**:

```bash
# Check webhook status
curl http://localhost:5000/api/webhooks/status

# Should show both webhooks registered:
# - orders/create
# - orders/updated
```

**Server Logs Check**:

- Look for log entries like: `[Webhook] Tag removed from order X, resolving order`
- Should see: `[Webhook] ✅ Signature verified successfully!`

---

**Test 3: Audit Logging for Resolutions**

**Steps**:

1. Dismiss an order manually (Test 1)
2. Remove tag from another order in Shopify (Test 2)
3. Check audit logs in database:

```sql
SELECT
  al.id,
  al.action,
  al.details,
  al.performed_at,
  o.order_number,
  o.resolved_by
FROM audit_logs al
JOIN orders o ON al.order_id = o.id
WHERE al.action IN ('dismissed', 'resolved')
ORDER BY al.performed_at DESC;
```

**Expected Result**:

- Each resolution should have an audit log entry
- `dismissed` action for manual dismissals
- `resolved` action for Shopify tag removals
- Details should include `resolvedBy` and `resolvedAt` information

---

**Test 4: Edge Cases**

**Test 4a: Dismiss Already Resolved Order**

**Steps**:

1. Try to dismiss an order that's already been resolved
2. Should show error message

**Expected Result**: Error message indicating order is not currently flagged

**Test 4b: Remove Tag from Non-Flagged Order**

**Steps**:

1. Remove "Merge_Review_Candidate" tag from an order that's not flagged in our system
2. Check webhook logs

**Expected Result**: Webhook processes but skips resolution (order not tracked or not flagged)

**Test 4c: Dismiss Non-Existent Order**

**Steps**:

1. Try to dismiss with invalid order ID:
   ```bash
   curl -X POST http://localhost:5000/api/orders/invalid-id/dismiss
   ```

**Expected Result**: Returns 404 error

---

**Test 5: Dashboard Refresh After Dismissal**

**Steps**:

1. Open dashboard with multiple flagged orders
2. Dismiss one order
3. Verify dashboard automatically refreshes (should happen within 30 seconds due to refetch interval)
4. Verify dismissed order is no longer visible

**Expected Result**:

- Dashboard updates automatically
- No manual refresh needed
- Toast notification confirms action

---

## Quick Test Script for Order Resolution

```bash
# 1. Check webhook status (should show both webhooks)
curl http://localhost:5000/api/webhooks/status

# 2. Get flagged orders
curl http://localhost:5000/api/orders/flagged

# 3. Dismiss an order (replace ORDER_ID with actual ID from step 2)
curl -X POST http://localhost:5000/api/orders/ORDER_ID/dismiss

# 4. Verify order is no longer in flagged list
curl http://localhost:5000/api/orders/flagged

# 5. Check audit logs (via database)
# psql postgresql://orderauditor:orderauditor@localhost:5432/orderauditor
# SELECT * FROM audit_logs WHERE action = 'dismissed' ORDER BY performed_at DESC LIMIT 1;
```

---

## Troubleshooting Order Resolution

### Order not disappearing after dismissal

- Check browser console for errors
- Verify API call succeeded (check Network tab)
- Check server logs for errors
- Verify database: `SELECT * FROM orders WHERE id = 'ORDER_ID'` - `isFlagged` should be `false`

### Tag not removed from Shopify

- Check Shopify API credentials are correct
- Verify `SHOPIFY_ACCESS_TOKEN` has `write_orders` scope
- Check server logs for Shopify API errors
- Order may still be dismissed in our system even if tag removal fails

### Webhook not detecting tag removal

- Verify `orders/updated` webhook is registered: `GET /api/webhooks/status`
- Check webhook is pointing to correct URL
- Verify HMAC signature verification is working (check server logs)
- Test webhook manually if needed

### Audit logs not created

- Check database connection
- Verify `audit_logs` table exists: `\d audit_logs` in psql
- Check server logs for database errors
