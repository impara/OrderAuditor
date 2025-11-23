# Test Scripts

## Create Test Order

Script to quickly create test orders in Shopify for testing duplicate detection.

### Prerequisites

- `.env` file configured with `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ACCESS_TOKEN`
- At least one product in your Shopify store (or the script will attempt to create an order without a product)

### Usage

#### Basic Usage

Create a test order with random customer data:

```bash
npm run test:order
# or
node scripts/create-test-order.js
```

#### Create Order with Specific Customer Data

```bash
node scripts/create-test-order.js \
  --email customer@example.com \
  --name "John Doe" \
  --phone "+1234567890" \
  --address "123 Main St" \
  --city "New York" \
  --zip "10001"
```

#### Create a Duplicate Order

To test duplicate detection, create a second order with the same customer email:

```bash
# First order
node scripts/create-test-order.js --email test@example.com --name "Test Customer"

# Second order (duplicate) - same email
node scripts/create-test-order.js --email test@example.com --name "Test Customer"
```

Or use the convenience script:

```bash
npm run test:duplicate
```

### Command Line Options

- `--email <email>` - Customer email address (default: random test email)
- `--name <name>` - Full customer name (default: "Test Customer")
- `--first <first>` - First name (default: extracted from --name)
- `--last <last>` - Last name (default: extracted from --name)
- `--phone <phone>` - Phone number (default: random US phone)
- `--address <address>` - Street address (default: random address)
- `--city <city>` - City (default: "Test City")
- `--province <province>` - State/Province (default: "CA")
- `--zip <zip>` - ZIP/Postal code (default: random)
- `--country <country>` - Country (default: "United States")
- `--duplicate` - Flag to indicate this is a duplicate test order

### Examples

**Create two orders from the same customer (duplicate test):**

```bash
# Order 1
node scripts/create-test-order.js \
  --email john@example.com \
  --name "John Smith" \
  --address "123 Oak St" \
  --city "San Francisco" \
  --zip "94102"

# Order 2 (duplicate - same email, same address)
node scripts/create-test-order.js \
  --email john@example.com \
  --name "John Smith" \
  --address "123 Oak St" \
  --city "San Francisco" \
  --zip "94102"
```

**Create order with different customer:**

```bash
node scripts/create-test-order.js \
  --email jane@example.com \
  --name "Jane Doe" \
  --address "456 Pine Ave" \
  --city "Los Angeles" \
  --zip "90001"
```

### Notes

- Orders are created with `financial_status: "pending"` so no payment is processed
- Receipt emails are disabled (`send_receipt: false`)
- The script will try to use an existing product from your store
- If no products exist, it will attempt to create an order with a test product (may fail if products are required)
- Each order includes a note: "Test order created by script"

### Troubleshooting

**Error: "Failed to create order"**

- Check that `SHOPIFY_SHOP_DOMAIN` and `SHOPIFY_ACCESS_TOKEN` are set correctly
- Verify your Shopify app has `write_orders` permission
- Ensure you have at least one product in your store

**Orders not showing in dashboard**

- Check webhook is registered: `curl https://your-domain.com/api/webhooks/status`
- Check application logs: `docker-compose logs -f app`
- Verify the webhook endpoint is receiving events


