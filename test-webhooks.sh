#!/bin/bash

# Test script for GDPR compliance webhooks
# Usage: ./test-webhooks.sh [ngrok-url] [webhook-secret]
#
# For Partner Apps: Use SHOPIFY_API_SECRET (Client Secret)
# For Legacy Custom Apps: Use SHOPIFY_WEBHOOK_SECRET

NGROK_URL="${1:-https://your-ngrok-url.ngrok.io}"
# Priority: SHOPIFY_API_SECRET (partner apps) > SHOPIFY_WEBHOOK_SECRET (legacy) > command line arg
WEBHOOK_SECRET="${2:-${SHOPIFY_API_SECRET:-$SHOPIFY_WEBHOOK_SECRET}}"

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "Error: Webhook secret not provided."
  echo "For Partner Apps: Set SHOPIFY_API_SECRET (Client Secret from Partner Dashboard)"
  echo "For Legacy Apps: Set SHOPIFY_WEBHOOK_SECRET"
  echo "Or pass as second argument: ./test-webhooks.sh [ngrok-url] [secret]"
  exit 1
fi

echo "Testing GDPR Compliance Webhooks"
echo "================================="
echo "NGROK URL: $NGROK_URL"
echo ""

# Function to generate HMAC
generate_hmac() {
  local payload="$1"
  echo -n "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -binary | base64
}

# Function to test webhook
test_webhook() {
  local topic="$1"
  local payload_file="$2"
  local delivery_id="$3"
  
  echo "Testing: $topic"
  echo "Payload: $payload_file"
  
  local payload=$(cat "$payload_file")
  local hmac=$(generate_hmac "$payload")
  
  local response=$(curl -s -w "\n%{http_code}" -X POST "$NGROK_URL/api/webhooks/shopify/$topic" \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Hmac-Sha256: $hmac" \
    -H "X-Shopify-Topic: $topic" \
    -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
    -H "X-Shopify-Delivery-Id: $delivery_id" \
    -d "$payload")
  
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)
  
  echo "HTTP Status: $http_code"
  echo "Response: $body"
  echo ""
}

# Test customers/data_request
echo "1. Testing customers/data_request"
test_webhook "customers/data_request" "test-payloads/customers-data-request.json" "test-delivery-data-request-$(date +%s)"
echo ""

# Test customers/redact with specific orders
echo "2. Testing customers/redact (with specific orders)"
test_webhook "customers/redact" "test-payloads/customers-redact.json" "test-delivery-redact-$(date +%s)"
echo ""

# Test customers/redact with empty array
echo "3. Testing customers/redact (empty array - should not redact)"
test_webhook "customers/redact" "test-payloads/customers-redact-empty.json" "test-delivery-redact-empty-$(date +%s)"
echo ""

# Test customers/redact with null
echo "4. Testing customers/redact (null - should redact all)"
test_webhook "customers/redact" "test-payloads/customers-redact-null.json" "test-delivery-redact-null-$(date +%s)"
echo ""

# Test shop/redact
echo "5. Testing shop/redact"
test_webhook "shop/redact" "test-payloads/shop-redact.json" "test-delivery-shop-redact-$(date +%s)"
echo ""

# Test duplicate detection
echo "6. Testing duplicate detection (same delivery ID twice)"
DELIVERY_ID="test-delivery-duplicate-$(date +%s)"
echo "First call:"
test_webhook "customers/data_request" "test-payloads/customers-data-request.json" "$DELIVERY_ID"
echo "Second call (should be duplicate):"
test_webhook "customers/data_request" "test-payloads/customers-data-request.json" "$DELIVERY_ID"
echo ""

echo "Testing complete!"
echo "Check your application logs and database to verify the results."

