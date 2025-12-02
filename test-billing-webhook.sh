#!/bin/bash

# Test script for Billing Sync webhook
# Usage: ./test-billing-webhook.sh [ngrok-url] [webhook-secret]

NGROK_URL="${1:-http://localhost:5000}"
# Priority: SHOPIFY_API_SECRET (partner apps) > SHOPIFY_WEBHOOK_SECRET (legacy) > command line arg
WEBHOOK_SECRET="${2:-${SHOPIFY_API_SECRET:-$SHOPIFY_WEBHOOK_SECRET}}"

if [ -z "$WEBHOOK_SECRET" ]; then
  # Try to load from .env if not set
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
    WEBHOOK_SECRET="${SHOPIFY_API_SECRET:-$SHOPIFY_WEBHOOK_SECRET}"
  fi
fi

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "Error: Webhook secret not provided and not found in .env"
  echo "Usage: ./test-billing-webhook.sh [ngrok-url] [secret]"
  exit 1
fi

echo "Testing Billing Sync Webhook"
echo "============================"
echo "URL: $NGROK_URL"
echo "Secret: ${WEBHOOK_SECRET:0:5}..."
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
    -H "X-Shopify-Shop-Domain: test-shop.myshopify.com" \
    -H "X-Shopify-Delivery-Id: $delivery_id" \
    -d "$payload")
  
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | head -n-1)
  
  echo "HTTP Status: $http_code"
  echo "Response: $body"
  echo ""
}

# Test app_subscriptions/update with different statuses
echo "1. Testing app_subscriptions/update (CANCELLED)"
test_webhook "app_subscriptions/update" "test-payloads/app-subscription-update.json" "test-delivery-billing-cancelled-$(date +%s)"

echo ""
echo "2. Testing app_subscriptions/update (ACTIVE)"
test_webhook "app_subscriptions/update" "test-payloads/app-subscription-update-active.json" "test-delivery-billing-active-$(date +%s)"

echo ""
echo "3. Testing app_subscriptions/update (FROZEN)"
test_webhook "app_subscriptions/update" "test-payloads/app-subscription-update-frozen.json" "test-delivery-billing-frozen-$(date +%s)"

echo ""
echo "4. Testing app_subscriptions/update (DECLINED)"
test_webhook "app_subscriptions/update" "test-payloads/app-subscription-update-declined.json" "test-delivery-billing-declined-$(date +%s)"

echo ""
echo "Testing complete!"
