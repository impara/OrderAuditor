# First-Scan Trust: Cosmetic and Informational Improvements Plan

> **For Hermes:** Use the software-development-lifecycle skill to implement this plan task-by-task with RED-GREEN-REFACTOR and a final diff review.

**Goal:** Improve how Duplicate Guard explains first-scan results and quota usage without changing detection, billing, stored data, Shopify data, or merchant settings.

**Architecture:** Preserve the historical-scan and live-order behavior exactly as it works today. Add a read-only summary derived from existing flagged-order rows, render clearer copy in the existing scan card, and correct visible quota labels. Keep the existing database schema and internal property names.

**Tech Stack:** TypeScript, Express, React, TanStack Query, Drizzle ORM, PostgreSQL, Vitest, Vite.

---

## Why the scope changed

The You Feel Good investigation suggests the first scan may have created a trust or explanation problem, but the merchant has not confirmed the cause. Changing matching criteria now would encode an assumption and could alter which orders other merchants see.

Until direct feedback arrives, implement only reversible presentation and read-only information improvements.

## Safety boundary

### Included

1. Explain completed historical-scan results using existing data:
   - orders checked;
   - orders flagged for review;
   - duplicate-looking groups;
   - stronger findings at 90–100%;
   - review findings at 70–89%;
   - signals found in the flagged records when available.
2. Add cautious copy explaining that findings are review signals, not confirmed duplicate orders.
3. Explain that Duplicate Guard compares details such as email, phone, address, name, and SKU; no settings are changed.
4. Correct visible quota wording so `monthlyOrderCount` is described as live duplicate flags, not total orders processed.

### Explicitly deferred pending merchant evidence

- Removing or changing `HISTORICAL_SCAN_MATCHING_PROFILE`.
- Making historical scans follow merchant settings.
- Changing default settings, score weights, thresholds, confidence bands, comparison windows, candidate caps, or historical-scan timing.
- Adding automatic actions, order changes, tags, notifications, or merchant-data retention.

### Hard non-goals

- No database migration.
- No writes to existing scan/order/settings/subscription records.
- No Admin API mutation.
- No billing, plan, or quota-size change.
- No uninstall-cleanup change.
- No deployment or service restart without separate approval.

## Acceptance criteria

- The same orders receive the same scores and flags before and after this work.
- No matching profile, threshold, setting, quota, billing, webhook, or Shopify mutation code changes.
- Scan-summary fields are additive and computed read-only from existing rows.
- Completed-scan copy distinguishes stronger findings from findings that need review.
- Zero-result, running, failed, retry, and candidate-cap states still render correctly.
- Visible quota copy never implies that `monthlyOrderCount` is total orders processed.
- Focused tests, full tests, typecheck, and production build pass.

---

### Task 1: Protect the no-behavior-change boundary

**Objective:** Add regression coverage that prevents this cosmetic project from changing duplicate detection.

**Files:**
- Modify: `server/services/order-processing.service.test.ts`
- Modify only if coverage is missing: `server/services/duplicate-detection.service.test.ts`

**Step 1: Add or retain a historical-mode regression test**

Assert that historical processing still:

- passes the existing historical matching profile;
- records `flagSource: "historical"` and `flaggedByScanRunId`;
- does not increment live quota;
- does not add Shopify tags;
- does not send notifications.

Do not change the production implementation in this task.

**Step 2: Run the focused tests**

```bash
npx vitest run \
  server/services/order-processing.service.test.ts \
  server/services/duplicate-detection.service.test.ts
```

Expected: PASS against the current production behavior. If a missing assertion requires a test-only edit, add it without changing production logic.

**Step 3: Commit test-only protection if changed**

```bash
git add server/services/*test.ts
git commit -m "test: protect historical scan behavior"
```

---

### Task 2: Add a pure read-only scan-summary helper

**Objective:** Classify existing flagged-order rows for display without writing or changing any record.

**Files:**
- Create: `server/services/historical-scan-summary.ts`
- Create: `server/services/historical-scan-summary.test.ts`

**Step 1: Write failing tests**

Cover:

1. empty findings;
2. confidence `90–100` counted as `strongerFindings`;
3. confidence `70–89` counted as `reviewFindings`;
4. boundary values `70`, `89`, `90`, and `100`;
5. duplicate signal names are deduplicated;
6. malformed or missing match reasons do not crash;
7. the input array is not mutated.

Use a return shape like:

```ts
interface HistoricalScanFindingSummary {
  flaggedOrders: number;
  strongerFindings: number;
  reviewFindings: number;
  signals: Array<"email" | "phone" | "address" | "name" | "sku">;
}
```

The confidence bands are display groupings only. They must not be imported into detection logic.

**Step 2: Run RED**

```bash
npx vitest run server/services/historical-scan-summary.test.ts
```

Expected: FAIL because the helper does not exist.

**Step 3: Implement the minimal pure function**

The helper may read only `confidenceScore` and `matchReason`. It must not import storage, Shopify services, billing, or detection settings.

**Step 4: Run GREEN**

```bash
npx vitest run server/services/historical-scan-summary.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add server/services/historical-scan-summary.ts server/services/historical-scan-summary.test.ts
git commit -m "feat: summarize historical scan findings for display"
```

---

### Task 3: Enrich the existing scan endpoint read-only

**Objective:** Add summary fields to the existing historical-scan response without changing persistence or scan execution.

**Files:**
- Modify: `server/routes.ts` near `safeHistoricalScan` and `/api/historical-scan/latest`
- Modify: `server/services/historical-scan.service.test.ts` or add a focused route/helper test if the route layer has a suitable harness

**Step 1: Write a failing response-shape test**

For a completed run, assert the safe response includes:

```ts
{
  flaggedOrders: 14,
  strongerFindings: 3,
  reviewFindings: 11,
  signals: ["email", "address", "name"]
}
```

Also assert queued/running/failed runs return zero/empty summary values safely.

**Step 2: Run RED**

```bash
npx vitest run server/services/historical-scan.service.test.ts
```

Expected: FAIL because the additive fields are absent.

**Step 3: Add read-only enrichment**

For completed scans only:

1. call `storage.getFlaggedOrdersForScan(run.id)`;
2. pass the rows to `summarizeHistoricalScanFindings()`;
3. add the result to the safe response.

Keep these existing response fields unchanged:

- `ordersFetched`;
- `ordersImported`;
- `matchesFound`;
- `candidateCapExceeded`;
- timestamps and status.

Do not update `historical_scan_runs`, `orders`, settings, subscriptions, or Shopify.

If the summary query fails, log the error and return the existing scan response with zero/empty additive summary fields. The dashboard must not lose the core scan state because optional explanation data failed.

**Step 4: Run GREEN**

```bash
npx vitest run \
  server/services/historical-scan-summary.test.ts \
  server/services/historical-scan.service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add server/routes.ts server/services/historical-scan*.ts
git commit -m "feat: expose read-only historical scan summary"
```

---

### Task 4: Format scan copy through a pure client helper

**Objective:** Keep merchant-facing language testable and separate from JSX.

**Files:**
- Create: `client/src/lib/historical-scan-summary.ts`
- Create: `client/src/lib/historical-scan-summary.test.ts`

**Step 1: Write failing copy tests**

Cover:

- completed scan with zero findings;
- completed scan with mixed stronger/review findings;
- stronger-only and review-only results;
- signal list formatting;
- no available signals;
- no wording that calls findings confirmed duplicates.

Required phrases:

- `orders checked`;
- `orders flagged for review`;
- `stronger matches`;
- `needs review`;
- `These are review signals, not automatic decisions.`

Informational criteria copy may say:

> Duplicate Guard compares order details such as email, phone, address, name, and SKU. Review each flagged order before taking action.

Do not say all signals matched or imply a fraud determination.

**Step 2: Run RED**

```bash
npx vitest run client/src/lib/historical-scan-summary.test.ts
```

Expected: FAIL because the formatter does not exist.

**Step 3: Implement the pure formatter**

Return display strings or a small view model. Do not add a component framework or dependency.

**Step 4: Run GREEN**

```bash
npx vitest run client/src/lib/historical-scan-summary.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add client/src/lib/historical-scan-summary.ts client/src/lib/historical-scan-summary.test.ts
git commit -m "feat: add cautious scan summary copy"
```

---

### Task 5: Update the completed historical-scan card

**Objective:** Show the new explanation without changing controls, scan initiation, retry behavior, or detection settings.

**Files:**
- Modify: `client/src/components/HistoricalScanCard.tsx`

**Step 1: Render the additive summary**

In the completed state, show:

1. `{ordersFetched} orders checked`;
2. `{flaggedOrders} orders flagged for review`;
3. `{matchesFound} duplicate-looking groups` when non-zero;
4. confidence breakdown;
5. signals found when available;
6. the cautious review sentence.

Use `ordersFetched` for checked orders. Do not substitute `ordersImported` or monthly quota usage.

**Step 2: Preserve every existing state**

Confirm no regression in:

- queued/running progress;
- zero findings;
- failure and retry;
- candidate-cap warning;
- timestamps;
- existing navigation links or buttons.

Do not add settings controls or change the scan trigger.

**Step 3: Run focused tests and typecheck**

```bash
npx vitest run client/src/lib/historical-scan-summary.test.ts
npm run check
```

Expected: PASS.

**Step 4: Commit**

```bash
git add client/src/components/HistoricalScanCard.tsx
git commit -m "feat: explain historical scan results"
```

---

### Task 6: Correct visible quota terminology only

**Objective:** Make existing usage numbers understandable without renaming database/API fields or changing quota behavior.

**Files to inspect and modify only where visible wording is inaccurate:**
- `client/src/pages/internal-admin.tsx`
- `client/src/pages/subscription.tsx`
- `client/src/components/QuotaWarningBanner.tsx`
- `client/src/components/QuotaHeaderBadge.tsx`
- user-facing documentation under `docs/`

**Step 1: Inventory visible wording**

Search:

```bash
rg -n -i "period usage|orders used|orders processed|monthly orders|order quota|monthlyOrderCount" client docs
```

Classify each hit:

- total orders genuinely processed;
- live duplicate flags used;
- legacy internal identifier.

**Step 2: Change copy, not identifiers**

Preferred terms:

- `Live duplicate flags`;
- `Duplicate flags used this month`;
- `Monthly duplicate-flag limit`.

Keep `monthlyOrderCount`, `allTimeOrderCount`, `incrementOrderCount()`, database columns, API keys, and billing calculations unchanged.

**Step 3: Add/update narrow text assertions where tests exist**

Do not create a broad component-testing stack only for labels. A pure copy constant/helper test is enough if no UI harness exists.

**Step 4: Verify**

```bash
npm run check
npx vitest run \
  server/services/subscription.service.test.ts \
  server/services/webhook-processor.service.test.ts
```

Expected: PASS with no backend behavior changes.

**Step 5: Commit**

```bash
git add client docs
git commit -m "fix: clarify duplicate flag usage labels"
```

Only add files that actually changed.

---

### Task 7: Final no-behavior-change verification

**Objective:** Prove the patch is cosmetic/informational and production-buildable.

**Step 1: Run focused tests**

```bash
npx vitest run \
  server/services/order-processing.service.test.ts \
  server/services/duplicate-detection.service.test.ts \
  server/services/historical-scan.service.test.ts \
  server/services/historical-scan-summary.test.ts \
  client/src/lib/historical-scan-summary.test.ts \
  server/services/subscription.service.test.ts \
  server/services/webhook-processor.service.test.ts
```

Expected: PASS.

**Step 2: Run full verification**

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: all commands exit 0.

**Step 3: Audit the diff against forbidden changes**

Fail review if the diff changes any of these:

- `HISTORICAL_SCAN_MATCHING_PROFILE` or matching-profile selection;
- detection weights or threshold comparisons;
- default detection settings;
- quota increments or limits;
- billing prices or subscription state;
- database schema/migrations;
- order, setting, subscription, or scan writes;
- Shopify tags, notifications, webhook registration, or Admin API mutations;
- uninstall deletion behavior.

A read-only `getFlaggedOrdersForScan()` call is the only intended server-side data access addition.

**Step 4: Manual isolated UI smoke test**

Using mock/development data only, verify:

1. no scan yet;
2. queued/running;
3. completed with zero findings;
4. completed with mixed 70–89 and 90–100 findings;
5. candidate-cap warning;
6. failed/retry;
7. accurate live duplicate-flag quota labels.

Do not use production Shopify credentials or production database data.

**Step 5: Review gate**

Stop after tests and diff review. Do not deploy, restart services, or modify production until Amer explicitly approves the reviewed patch.

---

## Deferred follow-up after merchant feedback

If You Feel Good replies, record the exact issue before reopening behavior changes:

- flagged orders looked incorrect;
- expected matching criteria differed;
- scan/setup was unclear;
- billing or another workflow failed;
- unrelated comparison-app preference.

Only then create a separate behavior-change plan with explicit acceptance criteria and development-shop reproduction. Do not silently fold detection changes into this cosmetic patch.
