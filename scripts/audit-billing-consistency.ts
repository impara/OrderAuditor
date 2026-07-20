import "dotenv/config";
import { parseBillingAuditArgs } from "./billing-audit-options";

function printHelp(): void {
  console.log(`Usage:
  npm run billing:audit
  npm run billing:audit -- --shop=store.myshopify.com
  npm run billing:audit -- --shop=store.myshopify.com --apply-active

The command is dry-run by default. --apply-active only performs a positive
sync from exactly one verified active Shopify subscription. It never cancels,
downgrades, or deletes.`);
}

async function main(): Promise<void> {
  const options = parseBillingAuditArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const [{ eq }, { db }, { getValidOfflineSession }, { billingReconciliationService }, schema] =
    await Promise.all([
      import("drizzle-orm"),
      import("../server/db"),
      import("../server/shopify-auth"),
      import("../server/services/billing-reconciliation.service"),
      import("../shared/schema"),
    ]);
  const { subscriptions } = schema;

  const rows = options.shop
    ? await db
        .select({ shop: subscriptions.shopifyShopDomain })
        .from(subscriptions)
        .where(eq(subscriptions.shopifyShopDomain, options.shop))
    : await db
        .select({ shop: subscriptions.shopifyShopDomain })
        .from(subscriptions);

  if (options.shop && rows.length === 0) {
    throw new Error(`No local subscription found for ${options.shop}`);
  }

  const results: Array<Record<string, unknown>> = [];
  let actionable = false;

  for (const row of rows) {
    const session = await getValidOfflineSession(row.shop);
    if (!session?.accessToken) {
      results.push({ shop: row.shop, kind: "unverified", reason: "no_valid_session" });
      continue;
    }

    const outcome = await billingReconciliationService.reconcileActive(
      row.shop,
      session.accessToken,
      { apply: options.applyActive }
    );
    if (["would_sync_active", "multiple_active", "no_active"].includes(outcome.kind)) {
      actionable = true;
    }
    results.push({
      shop: row.shop,
      ...outcome,
      ...(options.applyActive ? { mode: "apply_active" } : { mode: "dry_run" }),
    });
  }

  console.log(
    JSON.stringify(
      {
        auditedAt: new Date().toISOString(),
        mode: options.applyActive ? "apply_active" : "dry_run",
        count: results.length,
        results,
      },
      null,
      2
    )
  );

  if (!options.applyActive && actionable) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
