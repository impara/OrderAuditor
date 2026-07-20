import { pool } from "../db";

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const LOCK_NAMESPACE = "duplicate-guard-billing";

export async function withShopBillingLock<T>(
  shop: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!SHOP_DOMAIN_PATTERN.test(shop)) {
    throw new Error("Invalid Shopify shop domain");
  }

  const normalizedShop = shop.toLowerCase();
  const client = await pool.connect();
  let locked = false;
  let discardClient = false;

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext($1), hashtext($2))",
      [LOCK_NAMESPACE, normalizedShop]
    );
    locked = true;
    return await operation();
  } finally {
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))",
          [LOCK_NAMESPACE, normalizedShop]
        );
      } catch {
        // Never return a connection that might still own a session-level lock.
        discardClient = true;
      }
    }
    client.release(discardClient);
  }
}
