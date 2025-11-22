#!/usr/bin/env node

/**
 * Script to create test orders in Shopify for testing duplicate detection
 * 
 * Usage:
 *   node scripts/create-test-order.js
 *   node scripts/create-test-order.js --email test@example.com --name "Test Customer"
 *   node scripts/create-test-order.js --duplicate  # Creates a duplicate of the last order
 */

import "dotenv/config";
import { randomInt } from "crypto";

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = "2025-10";

if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    console.error("❌ Error: SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set in .env");
    process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : null;
};

const email = getArg("--email") || `test${randomInt(1000, 9999)}@example.com`;
const name = getArg("--name") || "Test Customer";
const firstName = getArg("--first") || name.split(" ")[0] || "Test";
const lastName = getArg("--last") || name.split(" ").slice(1).join(" ") || "Customer";
// Shopify requires phone in E.164 format: +[country code][number] (10 digits after country code)
// Generate valid US phone: +1 + area code (200-999) + exchange (200-999) + number (0000-9999)
// Phone number - can be skipped with --no-phone flag
const skipPhone = args.includes("--no-phone");
const phoneArg = getArg("--phone");
const phone = skipPhone ? null : (phoneArg || (() => {
    // Generate valid US phone in E.164 format: +1XXXXXXXXXX (11 digits total)
    const areaCode = randomInt(200, 999);
    const exchange = randomInt(200, 999);
    const number = randomInt(0, 9999).toString().padStart(4, '0');
    return `+1${areaCode}${exchange}${number}`;
})());
const address1 = getArg("--address") || `${randomInt(100, 9999)} Test Street`;
const city = getArg("--city") || "Test City";
const province = getArg("--province") || "CA";
const zip = getArg("--zip") || `${randomInt(10000, 99999)}`;
const country = getArg("--country") || "United States";
const isDuplicate = args.includes("--duplicate");

// Test product data (you may need to adjust these based on your store)
const DEFAULT_PRODUCT = {
    title: "Test Product",
    price: "10.00",
    sku: "TEST-PRODUCT",
};

async function createTestOrder() {
    const baseUrl = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${API_VERSION}`;

    try {
        // First, try to get a real product from the store
        let productId = null;
        let variantId = null;

        try {
            const productsResponse = await fetch(`${baseUrl}/products.json?limit=1`, {
                headers: {
                    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
                    "Content-Type": "application/json",
                },
            });

            if (productsResponse.ok) {
                const productsData = await productsResponse.json();
                if (productsData.products && productsData.products.length > 0) {
                    const product = productsData.products[0];
                    productId = product.id;
                    if (product.variants && product.variants.length > 0) {
                        variantId = product.variants[0].id;
                    }
                    console.log(`✓ Using existing product: ${product.title}`);
                }
            }
        } catch (error) {
            console.warn("⚠ Could not fetch products, will create order without product");
        }

        // If no product found, we'll create an order with a line item anyway
        // Shopify will handle it, though it might fail if products are required
        const lineItems = variantId
            ? [
                {
                    variant_id: variantId,
                    quantity: 1,
                },
            ]
            : [
                {
                    title: DEFAULT_PRODUCT.title,
                    price: DEFAULT_PRODUCT.price,
                    quantity: 1,
                },
            ];

        // Build order data - phone is optional in Shopify
        const orderData = {
            order: {
                email,
                ...(phone && { phone }), // Only include phone if provided
                first_name: firstName,
                last_name: lastName,
                line_items: lineItems,
                shipping_address: {
                    first_name: firstName,
                    last_name: lastName,
                    address1,
                    city,
                    province,
                    zip,
                    country,
                    ...(phone && { phone }), // Only include phone if provided
                },
                billing_address: {
                    first_name: firstName,
                    last_name: lastName,
                    address1,
                    city,
                    province,
                    zip,
                    country,
                    ...(phone && { phone }), // Only include phone if provided
                },
                financial_status: "pending", // Use "pending" so it doesn't charge
                send_receipt: false,
                send_fulfillment_receipt: false,
                note: "Test order created by script",
            },
        };

        console.log("\n📦 Creating test order...");
        console.log(`   Email: ${email}`);
        console.log(`   Name: ${firstName} ${lastName}`);
        console.log(`   Phone: ${phone || "not provided"}`);
        console.log(`   Address: ${address1}, ${city}, ${zip}`);

        const response = await fetch(`${baseUrl}/orders.json`, {
            method: "POST",
            headers: {
                "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(orderData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Failed to create order: ${response.status} ${response.statusText}`);
            console.error(`   Error: ${errorText}`);
            process.exit(1);
        }

        const result = await response.json();
        const order = result.order;

        console.log(`\n✅ Order created successfully!`);
        console.log(`   Order ID: ${order.id}`);
        console.log(`   Order Number: ${order.order_number || order.name}`);
        console.log(`   Order URL: https://${SHOPIFY_SHOP_DOMAIN}/admin/orders/${order.id}`);
        console.log(`\n💡 To create a duplicate, run:`);
        console.log(`   node scripts/create-test-order.js --email ${email} --name "${firstName} ${lastName}"`);

        return order;
    } catch (error) {
        console.error("❌ Error creating order:", error.message);
        process.exit(1);
    }
}

// Run the script
createTestOrder();

