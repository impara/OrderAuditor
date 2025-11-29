
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

  // Scenario 1: Default behavior (matchAddressOnlyIfPresent = false)
  // Expectation: Address is enabled but missing -> counts as mismatch or at least not a match.
  // Email (40) + Name (20) = 60. Address (0). Total 60.
  // Enabled criteria: Email, Address. Count = 2.
  // Single criterion boost does NOT trigger because enabled count is 2.
  console.log("\n--- Scenario 1: Default Behavior (matchAddressOnlyIfPresent = false) ---");
  const settingsDefault = {
    matchEmail: true,
    matchPhone: false,
    matchAddress: true,
    matchAddressOnlyIfPresent: false,
    addressSensitivity: "medium"
  };

  // Access private method via any cast or testing utility if possible, 
  // but since it's private we might need to rely on findDuplicates or just test the public method if we can mock the DB.
  // Since we can't easily mock the DB for findDuplicates without more setup, 
  // let's use the fact that calculateMatch is private but we are running in a script that imports the class instance.
  // We can try to access it if we cast to any.
  
  const matchDefault = (duplicateDetectionService as any).calculateMatch(
    newOrderMissingAddress, 
    existingOrder, 
    settingsDefault
  );

  console.log(`Confidence: ${matchDefault?.confidence ?? "null"}`);
  console.log(`Reason: ${matchDefault?.reason ?? "null"}`);
  
  if (!matchDefault || matchDefault.confidence < 70) {
    console.log("✅ PASS: Correctly identified as NOT a duplicate (confidence < 70)");
  } else {
    console.log("❌ FAIL: Should have been < 70 confidence");
  }


  // Scenario 2: New Setting (matchAddressOnlyIfPresent = true)
  // Expectation: Address is enabled but missing -> ignored.
  // Enabled criteria: Email. Count = 1.
  // Single criterion boost TRIGGERS -> Confidence boosted to 75.
  // Name match adds 20? Or is it max(score, 75)?
  // Logic: 
  // 1. Email match = 40.
  // 2. Name match = 20. Total = 60.
  // 3. Enabled criteria count = 1 (Email only, Address ignored).
  // 4. Matched criteria count = 1 (Email).
  // 5. Boost: max(60, 75) = 75.
  
  console.log("\n--- Scenario 2: New Setting (matchAddressOnlyIfPresent = true) ---");
  const settingsNew = {
    matchEmail: true,
    matchPhone: false,
    matchAddress: true,
    matchAddressOnlyIfPresent: true,
    addressSensitivity: "medium"
  };

  const matchNew = (duplicateDetectionService as any).calculateMatch(
    newOrderMissingAddress, 
    existingOrder, 
    settingsNew
  );

  console.log(`Confidence: ${matchNew?.confidence ?? "null"}`);
  console.log(`Reason: ${matchNew?.reason ?? "null"}`);

  if (matchNew && matchNew.confidence >= 70) {
    console.log("✅ PASS: Correctly identified as duplicate (confidence >= 70)");
  } else {
    console.log("❌ FAIL: Should have been >= 70 confidence");
  }
}

runVerification().catch(console.error);
