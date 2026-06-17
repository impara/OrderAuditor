#!/usr/bin/env tsx

/**
 * Migrate non-expiring Shopify offline tokens to expiring offline tokens.
 *
 * Shopify is deprecating non-expiring offline access tokens. Public apps must
 * migrate before January 1, 2027. This script exchanges each shop's existing
 * non-expiring offline token for an expiring one (access token + rotating
 * refresh token) using `shopify.auth.migrateToExpiringToken`, then persists the
 * resulting session.
 *
 * IMPORTANT:
 * - This is a ONE-TIME, IRREVERSIBLE migration per shop. A successful exchange
 *   immediately revokes the old non-expiring token, so the schema/storage that
 *   persists `refresh_token` MUST be deployed and working before running this.
 * - The script is idempotent: it only targets shops that still have a
 *   non-expiring token (refresh_token IS NULL).
 *
 * Usage:
 *   tsx scripts/migrate-offline-tokens.ts --dry-run          List candidates only
 *   tsx scripts/migrate-offline-tokens.ts --shop=foo.myshopify.com   Migrate one shop
 *   tsx scripts/migrate-offline-tokens.ts                    Migrate all candidates
 */

// Load environment variables before importing modules that depend on them.
import "dotenv/config";

import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../server/db";
import { shopifySessions } from "../shared/schema";
import { shopify, storeSessionWithRetry } from "../server/shopify-auth";
import { logger } from "../server/utils/logger";

interface MigrationCandidate {
  shop: string;
  accessToken: string;
}

interface MigrationResult {
  shop: string;
  status: "migrated" | "skipped" | "failed";
  error?: string;
  // Set when the exchange succeeded (old token revoked) but persistence failed.
  // This is unrecoverable by re-running the script and requires attention.
  stranded?: boolean;
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const shopArg = args.find((a) => a.startsWith("--shop="));
  const shop = shopArg ? shopArg.split("=")[1]?.trim() : undefined;
  return { dryRun, shop };
}

async function loadCandidates(targetShop?: string): Promise<MigrationCandidate[]> {
  const whereClause = targetShop
    ? and(
        eq(shopifySessions.isOnline, false),
        isNull(shopifySessions.refreshToken),
        eq(shopifySessions.shop, targetShop)
      )
    : and(
        eq(shopifySessions.isOnline, false),
        isNull(shopifySessions.refreshToken)
      );

  const rows = await db
    .select({
      shop: shopifySessions.shop,
      accessToken: shopifySessions.accessToken,
    })
    .from(shopifySessions)
    .where(whereClause);

  return rows
    .filter((r): r is MigrationCandidate => Boolean(r.accessToken))
    .map((r) => ({ shop: r.shop, accessToken: r.accessToken as string }));
}

async function migrateShop(candidate: MigrationCandidate): Promise<MigrationResult> {
  const { shop, accessToken } = candidate;
  try {
    const { session } = await shopify.auth.migrateToExpiringToken({
      shop,
      nonExpiringOfflineAccessToken: accessToken,
    });

    if (!session.refreshToken) {
      // Defensive: Shopify should always return a refresh token here.
      return {
        shop,
        status: "failed",
        error: "Migration returned a session without a refresh token",
      };
    }

    // The exchange has already revoked the old non-expiring token, so persistence
    // failure here strands the shop. Retry aggressively before giving up.
    const stored = await storeSessionWithRetry(session, 5);
    if (!stored) {
      return {
        shop,
        status: "failed",
        stranded: true,
        error:
          "migrateToExpiringToken succeeded but the new refresh token could not be persisted (shop is STRANDED and needs reinstall)",
      };
    }

    return { shop, status: "migrated" };
  } catch (error: any) {
    return { shop, status: "failed", error: error?.message || String(error) };
  }
}

async function main() {
  const { dryRun, shop } = parseArgs(process.argv);

  logger.info(
    `[MigrateTokens] Starting offline-token migration${
      shop ? ` for shop ${shop}` : ""
    }${dryRun ? " (dry run)" : ""}`
  );

  const candidates = await loadCandidates(shop);

  if (candidates.length === 0) {
    logger.info(
      "[MigrateTokens] No shops require migration (all offline tokens already expiring)."
    );
    return;
  }

  logger.info(
    `[MigrateTokens] Found ${candidates.length} shop(s) with non-expiring offline tokens:`
  );
  for (const c of candidates) {
    logger.info(`  - ${c.shop}`);
  }

  if (dryRun) {
    logger.info("[MigrateTokens] Dry run complete. No changes were made.");
    return;
  }

  const results: MigrationResult[] = [];
  let aborted = false;
  for (const candidate of candidates) {
    logger.info(`[MigrateTokens] Migrating ${candidate.shop}...`);
    const result = await migrateShop(candidate);
    results.push(result);
    if (result.status === "migrated") {
      logger.info(`[MigrateTokens] ✅ ${candidate.shop} migrated successfully`);
    } else {
      logger.error(
        `[MigrateTokens] ❌ ${candidate.shop} ${result.status}: ${result.error}`
      );
    }

    // If a shop was stranded (exchange succeeded but persistence failed), abort
    // the batch immediately. Continuing risks stranding more shops if the DB is
    // unhealthy, and this shop needs manual attention regardless.
    if (result.stranded) {
      logger.error(
        `[MigrateTokens] ABORTING: ${candidate.shop} was stranded (token exchanged but not persisted). Investigate the database before retrying.`
      );
      aborted = true;
      break;
    }
  }

  const migrated = results.filter((r) => r.status === "migrated").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const stranded = results.filter((r) => r.stranded).length;

  logger.info(
    `[MigrateTokens] Done. Migrated: ${migrated}, Failed: ${failed}, Total: ${results.length}`
  );

  if (stranded > 0) {
    logger.error(
      `[MigrateTokens] ${stranded} shop(s) were STRANDED (token revoked but not persisted). These shops must reinstall the app to obtain a fresh token.`
    );
  }

  if (aborted) {
    logger.error(
      "[MigrateTokens] Batch aborted before processing all candidates. Fix the persistence issue, then re-run to continue with the remaining shops."
    );
  }

  if (failed > 0 || aborted) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    logger.error("[MigrateTokens] Fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
