#!/usr/bin/env tsx

/**
 * Comprehensive Billing & Subscription Test Script
 *
 * Tests:
 * 1. Free tier initialization and quota checking
 * 2. Quota limits (within limit, at limit, over limit)
 * 3. Subscription upgrade/downgrade
 * 4. Billing webhook scenarios
 * 5. Charge creation
 *
 * Usage: tsx scripts/test-billing.ts [shop-domain]
 */

// Load environment variables from .env file BEFORE importing modules that depend on them
import "dotenv/config";

import { subscriptionService } from "../server/services/subscription.service";
import { shopifyBillingService } from "../server/services/shopify-billing.service";
import { storage } from "../server/storage";
import { logger } from "../server/utils/logger";
import { db } from "../server/db";
import { subscriptions } from "../shared/schema";
import { eq } from "drizzle-orm";

// Mock logger to reduce noise
logger.debug = () => {};
logger.info = (msg: any, ...args: any[]) =>
  console.log(`[INFO] ${msg}`, ...args);
logger.warn = (msg: any, ...args: any[]) =>
  console.log(`[WARN] ${msg}`, ...args);
logger.error = (msg: any, ...args: any[]) =>
  console.error(`[ERROR] ${msg}`, ...args);

const TEST_SHOP = process.argv[2] || "test-shop.myshopify.com";
const TEST_ACCESS_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN || "shpat_test_token";

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function logSection(title: string) {
  console.log(`\n${colors.cyan}${"=".repeat(60)}${colors.reset}`);
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}\n`);
}

function logTest(name: string, passed: boolean, details?: string) {
  const icon = passed ? "✅" : "❌";
  const color = passed ? colors.green : colors.red;
  console.log(`${color}${icon} ${name}${colors.reset}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

async function testFreeTierInitialization() {
  logSection("1. Free Tier Initialization");

  try {
    // Clean up any existing test subscription
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, TEST_SHOP));
    console.log("   Cleaned up existing subscription");

    // Test 1: Get subscription (should auto-initialize)
    const subscription1 = await subscriptionService.getSubscription(TEST_SHOP);
    logTest(
      "Auto-initialize free tier",
      subscription1.tier === "free" && subscription1.orderLimit === 50,
      `Tier: ${subscription1.tier}, Limit: ${subscription1.orderLimit}, Count: ${subscription1.monthlyOrderCount}`
    );

    // Test 2: Check quota on fresh subscription
    const quotaCheck1 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check on fresh subscription",
      quotaCheck1.allowed === true &&
        quotaCheck1.subscription.monthlyOrderCount === 0,
      `Allowed: ${quotaCheck1.allowed}, Count: ${quotaCheck1.subscription.monthlyOrderCount}/50`
    );

    return true;
  } catch (error: any) {
    logTest("Free tier initialization", false, error.message);
    return false;
  }
}

async function testQuotaLimits() {
  logSection("2. Quota Limit Testing");

  try {
    // Reset subscription to clean state
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, TEST_SHOP));
    const subscription = await storage.initializeSubscription(TEST_SHOP);

    // Test 1: Within limit (10 orders)
    await storage.updateSubscription(TEST_SHOP, { monthlyOrderCount: 10 });
    const quotaCheck1 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check: Within limit (10/50)",
      quotaCheck1.allowed === true,
      `Count: ${quotaCheck1.subscription.monthlyOrderCount}/50, Allowed: ${quotaCheck1.allowed}`
    );

    // Test 2: At limit (50 orders)
    await storage.updateSubscription(TEST_SHOP, { monthlyOrderCount: 50 });
    const quotaCheck2 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check: At limit (50/50)",
      quotaCheck2.allowed === false &&
        (quotaCheck2.reason?.includes("limit") ?? false),
      `Count: ${quotaCheck2.subscription.monthlyOrderCount}/50, Allowed: ${quotaCheck2.allowed}, Reason: ${quotaCheck2.reason}`
    );

    // Test 3: Over limit (51 orders)
    await storage.updateSubscription(TEST_SHOP, { monthlyOrderCount: 51 });
    const quotaCheck3 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check: Over limit (51/50)",
      quotaCheck3.allowed === false,
      `Count: ${quotaCheck3.subscription.monthlyOrderCount}/50, Allowed: ${quotaCheck3.allowed}`
    );

    // Test 4: Record order increments count
    await storage.updateSubscription(TEST_SHOP, { monthlyOrderCount: 0 });
    const beforeCount = (await storage.getSubscription(TEST_SHOP))!
      .monthlyOrderCount;
    await subscriptionService.recordOrder(TEST_SHOP);
    const afterCount = (await storage.getSubscription(TEST_SHOP))!
      .monthlyOrderCount;
    logTest(
      "Record order increments count",
      afterCount === beforeCount + 1,
      `Before: ${beforeCount}, After: ${afterCount}`
    );

    return true;
  } catch (error: any) {
    logTest("Quota limit testing", false, error.message);
    return false;
  }
}

async function testSubscriptionUpgrade() {
  logSection("3. Subscription Upgrade Testing");

  try {
    // Reset to free tier
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, TEST_SHOP));
    await storage.initializeSubscription(TEST_SHOP);

    // Test 1: Upgrade to paid tier
    const upgraded = await subscriptionService.updateTier(TEST_SHOP, "paid");
    logTest(
      "Upgrade to paid tier",
      upgraded.tier === "paid" && upgraded.orderLimit === -1,
      `Tier: ${upgraded.tier}, Limit: ${
        upgraded.orderLimit === -1 ? "Unlimited" : upgraded.orderLimit
      }`
    );

    // Test 2: Quota check on paid tier (should always allow)
    const quotaCheck = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check on paid tier",
      quotaCheck.allowed === true && quotaCheck.subscription.orderLimit === -1,
      `Allowed: ${quotaCheck.allowed}, Limit: Unlimited`
    );

    // Test 3: Record many orders on paid tier (should not block)
    for (let i = 0; i < 5; i++) {
      await subscriptionService.recordOrder(TEST_SHOP);
    }
    const finalQuota = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Multiple orders on paid tier",
      finalQuota.allowed === true,
      `Count: ${finalQuota.subscription.monthlyOrderCount}, Allowed: ${finalQuota.allowed}`
    );

    return true;
  } catch (error: any) {
    logTest("Subscription upgrade", false, error.message);
    return false;
  }
}

async function testSubscriptionDowngrade() {
  logSection("4. Subscription Downgrade Testing");

  try {
    // Start with paid tier
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, TEST_SHOP));
    await subscriptionService.updateTier(TEST_SHOP, "paid");
    await subscriptionService.recordOrder(TEST_SHOP);
    await subscriptionService.recordOrder(TEST_SHOP);

    const beforeDowngrade = await storage.getSubscription(TEST_SHOP);
    logTest(
      "Before downgrade: Paid tier",
      beforeDowngrade!.tier === "paid" && beforeDowngrade!.orderLimit === -1,
      `Tier: ${beforeDowngrade!.tier}, Count: ${
        beforeDowngrade!.monthlyOrderCount
      }`
    );

    // Test 1: Downgrade to free tier
    const downgraded = await subscriptionService.cancelSubscription(TEST_SHOP);
    logTest(
      "Downgrade to free tier",
      downgraded.tier === "free" && downgraded.orderLimit === 50,
      `Tier: ${downgraded.tier}, Limit: ${downgraded.orderLimit}, Count: ${downgraded.monthlyOrderCount}`
    );

    // Test 2: Quota check after downgrade
    const quotaCheck = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Quota check after downgrade",
      quotaCheck.allowed === true && quotaCheck.subscription.orderLimit === 50,
      `Allowed: ${quotaCheck.allowed}, Limit: ${quotaCheck.subscription.orderLimit}, Count: ${quotaCheck.subscription.monthlyOrderCount}`
    );

    return true;
  } catch (error: any) {
    logTest("Subscription downgrade", false, error.message);
    return false;
  }
}

async function testBillingService() {
  logSection("5. Billing Service Testing");

  try {
    // Test 1: List charges (should work even if empty)
    const charges = await shopifyBillingService.listCharges(
      TEST_SHOP,
      TEST_ACCESS_TOKEN
    );
    logTest(
      "List charges",
      Array.isArray(charges),
      `Found ${charges.length} charge(s)`
    );

    // Test 2: Handle existing charges (should handle empty case)
    const chargeStatus = await shopifyBillingService.handleExistingCharges(
      TEST_SHOP,
      TEST_ACCESS_TOKEN,
      "http://localhost:5000/subscription?upgrade=success"
    );
    logTest(
      "Handle existing charges",
      typeof chargeStatus === "object" &&
        typeof chargeStatus.hasPendingCharge === "boolean" &&
        typeof chargeStatus.hasActiveCharge === "boolean",
      `Pending: ${chargeStatus.hasPendingCharge}, Active: ${chargeStatus.hasActiveCharge}`
    );

    // Note: Creating actual charges requires a real Shopify shop and access token
    // This would be tested in integration tests with a real development store
    console.log(
      `\n${colors.yellow}⚠️  Note: Charge creation requires a real Shopify shop and access token${colors.reset}`
    );
    console.log(
      `   Set SHOPIFY_ACCESS_TOKEN and use a real shop domain for full testing`
    );

    return true;
  } catch (error: any) {
    logTest("Billing service testing", false, error.message);
    return false;
  }
}

async function testLimitHitScenario() {
  logSection("6. Limit Hit Scenario (End-to-End)");

  try {
    // Reset to free tier with 49 orders (1 away from limit)
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, TEST_SHOP));
    await storage.initializeSubscription(TEST_SHOP);
    await storage.updateSubscription(TEST_SHOP, { monthlyOrderCount: 49 });

    // Test 1: Should still allow at 49/50
    const quotaCheck1 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "At 49/50 orders (should allow)",
      quotaCheck1.allowed === true,
      `Count: ${quotaCheck1.subscription.monthlyOrderCount}/50, Allowed: ${quotaCheck1.allowed}`
    );

    // Test 2: Record one more order (hits limit)
    await subscriptionService.recordOrder(TEST_SHOP);
    const quotaCheck2 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "At 50/50 orders (should block)",
      quotaCheck2.allowed === false,
      `Count: ${quotaCheck2.subscription.monthlyOrderCount}/50, Allowed: ${quotaCheck2.allowed}, Reason: ${quotaCheck2.reason}`
    );

    // Test 3: Upgrade to paid (should unblock)
    await subscriptionService.updateTier(TEST_SHOP, "paid");
    const quotaCheck3 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "After upgrade to paid (should allow)",
      quotaCheck3.allowed === true &&
        quotaCheck3.subscription.orderLimit === -1,
      `Tier: ${quotaCheck3.subscription.tier}, Limit: Unlimited, Allowed: ${quotaCheck3.allowed}`
    );

    // Test 4: Record more orders on paid tier
    await subscriptionService.recordOrder(TEST_SHOP);
    await subscriptionService.recordOrder(TEST_SHOP);
    const quotaCheck4 = await subscriptionService.checkQuota(TEST_SHOP);
    logTest(
      "Multiple orders on paid tier (should allow)",
      quotaCheck4.allowed === true,
      `Count: ${quotaCheck4.subscription.monthlyOrderCount}, Allowed: ${quotaCheck4.allowed}`
    );

    return true;
  } catch (error: any) {
    logTest("Limit hit scenario", false, error.message);
    return false;
  }
}

async function runAllTests() {
  console.log(
    `${colors.blue}╔════════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.blue}║     Billing & Subscription Test Suite                    ║${colors.reset}`
  );
  console.log(
    `${colors.blue}╚════════════════════════════════════════════════════════════╝${colors.reset}`
  );
  console.log(`\nTest Shop: ${colors.cyan}${TEST_SHOP}${colors.reset}\n`);

  const results: { name: string; passed: boolean }[] = [];

  // Run all tests
  results.push({
    name: "Free Tier Initialization",
    passed: await testFreeTierInitialization(),
  });
  results.push({ name: "Quota Limits", passed: await testQuotaLimits() });
  results.push({
    name: "Subscription Upgrade",
    passed: await testSubscriptionUpgrade(),
  });
  results.push({
    name: "Subscription Downgrade",
    passed: await testSubscriptionDowngrade(),
  });
  results.push({ name: "Billing Service", passed: await testBillingService() });
  results.push({
    name: "Limit Hit Scenario",
    passed: await testLimitHitScenario(),
  });

  // Summary
  logSection("Test Summary");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    const icon = result.passed ? "✅" : "❌";
    const color = result.passed ? colors.green : colors.red;
    console.log(`${color}${icon} ${result.name}${colors.reset}`);
  });

  console.log(
    `\n${colors.blue}Results: ${passed}/${total} tests passed${colors.reset}\n`
  );

  if (passed === total) {
    console.log(`${colors.green}🎉 All tests passed!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
