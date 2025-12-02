
import { duplicateDetectionService } from "../server/services/duplicate-detection.service";
import { logger } from "../server/utils/logger";

// Mock logger to avoid cluttering output
logger.debug = () => {};
logger.info = (msg) => console.log(`[INFO] ${msg}`);
logger.warn = (msg) => console.log(`[WARN] ${msg}`);
logger.error = (msg) => console.error(`[ERROR] ${msg}`);

async function runVerification() {
  console.log("Starting verification of duplicate detection logic...");

  // Mock data
  const existingOrder = {
    id: "existing-1",
    orderNumber: "1001",
    customerEmail: "test@example.com",
    customerPhone: null,
    customerName: "John Doe",
    shippingAddress: {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
      country: "US"
    }
  };

  const newOrderMissingAddress = {
    customerEmail: "test@example.com",
    customerPhone: null,
    customerName: "John Doe",
    shippingAddress: null // Missing address
  };

  // Scenario 1: Email + Name match with missing address (digital product)
  // Expectation: Email (50) + Name (20) = 70 points → Flagged ✓
  // Address is enabled but missing → automatically skipped
  console.log("\n--- Scenario 1: Email + Name Match (Missing Address) ---");
  const settingsEmailEnabled = {
    matchEmail: true,
    matchPhone: false,
    matchAddress: true, // Enabled but will be skipped if missing
  };

  const matchScenario1 = (duplicateDetectionService as any).calculateMatch(
    newOrderMissingAddress,
    existingOrder,
    settingsEmailEnabled
  );

  console.log(`Confidence: ${matchScenario1?.confidence ?? "null"}`);
  console.log(`Reason: ${matchScenario1?.reason ?? "null"}`);
  console.log(`Expected: 70 (Email 50 + Name 20)`);

  if (matchScenario1 && matchScenario1.confidence >= 70) {
    console.log("✅ PASS: Correctly identified as duplicate (confidence >= 70)");
  } else {
    console.log("❌ FAIL: Should have been >= 70 confidence");
  }

  // Scenario 2: Email + Full Address + Name match
  // Expectation: Email (50) + Full Address (45) + Name (20) = 115 points (capped at 100)
  console.log("\n--- Scenario 2: Email + Full Address + Name Match ---");
  const newOrderWithAddress = {
    customerEmail: "test@example.com",
    customerPhone: null,
    customerName: "John Doe",
    shippingAddress: {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
      country: "US",
    },
  };

  const matchScenario2 = (duplicateDetectionService as any).calculateMatch(
    newOrderWithAddress,
    existingOrder,
    settingsEmailEnabled
  );

  console.log(`Confidence: ${matchScenario2?.confidence ?? "null"}`);
  console.log(`Reason: ${matchScenario2?.reason ?? "null"}`);
  console.log(`Expected: 100 (capped from Email 50 + Address 45 + Name 20 = 115)`);

  if (matchScenario2 && matchScenario2.confidence >= 70) {
    console.log("✅ PASS: Correctly identified as duplicate");
  } else {
    console.log("❌ FAIL: Should have been >= 70 confidence");
  }

  // Scenario 3: Address-only mode (should NOT flag without name)
  // Expectation: Full Address (45) only = 45 points → NOT flagged
  console.log("\n--- Scenario 3: Address-Only Mode (No Email/Phone) ---");
  const settingsAddressOnly = {
    matchEmail: false,
    matchPhone: false,
    matchAddress: true,
  };

  const newOrderDifferentEmail = {
    customerEmail: "different@example.com",
    customerPhone: null,
    customerName: null, // No name match
    shippingAddress: {
      address1: "123 Main St",
      city: "New York",
      zip: "10001",
      country: "US",
    },
  };

  const matchScenario3 = (duplicateDetectionService as any).calculateMatch(
    newOrderDifferentEmail,
    existingOrder,
    settingsAddressOnly
  );

  console.log(`Confidence: ${matchScenario3?.confidence ?? "null"}`);
  console.log(`Reason: ${matchScenario3?.reason ?? "null"}`);
  console.log(`Expected: 45 (Address only, no name match)`);

  if (matchScenario3 && matchScenario3.confidence < 70) {
    console.log("✅ PASS: Correctly NOT flagged (confidence < 70)");
    console.log("   Note: Address-only detection requires enabling Email or Phone for reliable results");
  } else {
    console.log("❌ FAIL: Should have been < 70 confidence");
  }

  // Scenario 4: Phone + Partial Address + Name match
  // Expectation: Phone (50) + Partial Address (25) + Name (20) = 95 points → Flagged ✓
  console.log("\n--- Scenario 4: Phone + Partial Address + Name Match ---");
  const settingsPhoneEnabled = {
    matchEmail: false,
    matchPhone: true,
    matchAddress: true,
  };

  const orderWithPhoneAndPartialAddress = {
    customerEmail: "different@example.com",
    customerPhone: "+11234567890",
    customerName: "John Doe",
    shippingAddress: {
      address1: "123 Main St",
      city: "New York",
      zip: "99999", // Different ZIP → partial match
      country: "US",
    },
  };

  const existingOrderWithPhone = {
    ...existingOrder,
    customerPhone: "(123) 456-7890", // Different format, same number
  };

  const matchScenario4 = (duplicateDetectionService as any).calculateMatch(
    orderWithPhoneAndPartialAddress,
    existingOrderWithPhone,
    settingsPhoneEnabled
  );

  console.log(`Confidence: ${matchScenario4?.confidence ?? "null"}`);
  console.log(`Reason: ${matchScenario4?.reason ?? "null"}`);
  console.log(`Expected: 95 (Phone 50 + Partial Address 25 + Name 20)`);

  if (matchScenario4 && matchScenario4.confidence >= 70) {
    console.log("✅ PASS: Correctly identified as duplicate");
  } else {
    console.log("❌ FAIL: Should have been >= 70 confidence");
  }

  console.log("\n=== Verification Complete ===");
}

runVerification().catch(console.error);
