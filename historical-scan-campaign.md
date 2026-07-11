# Immediate 60-Day Historical Order Scan Implementation Plan

> **For Hermes:** Implement task-by-task with tests before exposing this as an acquisition offer.

**Goal:** On first run, automatically scan Shopify’s default available 60-day order window and show an immediate, read-only proof state such as: `237 orders checked · 4 duplicate-looking groups found` in the existing dashboard.

**Architecture:** Refactor the current webhook-only order path into a shared processor with explicit live and historical modes. Historical scans fetch orders with the existing `read_orders` scope, map them through the same mapper as live webhooks, persist them, and calculate duplicate groups in chronological order. Historical mode must never call Shopify tagging, notifications, subscription quota checks, or live duplicate-count incrementing. The existing queue infrastructure runs the scan out of band; the dashboard polls for a scan result and displays existing flagged-order UI immediately.

**Tech stack:** TypeScript, Express, Shopify Admin API wrapper, PostgreSQL/Drizzle, pg-boss, React + React Query, Vitest.

**Launch boundary:** Shopify’s default `read_orders` access covers the last 60 days. V1 must clamp scans to 60 days and must not request `read_all_orders`. Do not announce or email the historical-scan offer until all tests pass and a controlled development-shop scan completes.

---

## Non-negotiable product rules

- The scan is **read-only in Shopify**. It must not tag, merge, cancel, refund, hold, or alter any historical Shopify order.
- Historical matches are **duplicate-looking review signals**, not proof of promotion abuse or fraud.
- A historical scan must not consume free-plan quota, increment live duplicate metrics, or trigger email/Slack alerts.
- Reuse the existing `read_orders` scope in `server/shopify-auth.ts`; do not add `read_all_orders`.
- Persist imported orders so future live `orders/create` webhooks compare against them, but retain the existing uninstall cleanup path.
- Do not make the scan range configurable in v1. Hard cap: 60 days.
- **One persistent logical scan run per shop (v1).** A shop has at most one `historical_scan_runs` row, ever (uninstall cleanup deletes it; reinstall starts fresh). A manual retry after `failed` transitions the *same row* back to `queued` — it never creates a second row. The run keeps its original `id`, `requestedAt`, and frozen 60-day window across retries, so orders flagged by an earlier attempt keep a valid `flaggedByScanRunId` and are included in the final group count. New installs may auto-start the run once; a retry is allowed only from a terminal state.

## Current code anchors

| Existing component | Path | Reuse/change |
|---|---|---|
| Inline Shopify → internal mapping | `server/services/webhook-processor.service.ts:192-207` | Extract to a pure shared mapper. |
| Live webhook processor | `server/services/webhook-processor.service.ts` | Delegate to shared processing service with `mode: "live"`. |
| Duplicate matching | `server/services/duplicate-detection.service.ts` | Use `newOrder.createdAt` as the time-window reference; add chronological batch use. |
| Current clock bug | `duplicate-detection.service.ts:61-64` | Replace `new Date()` reference with `newOrder.createdAt`. |
| Persistence | `server/storage.ts:createOrder` | Reuse for both modes after shared processing decides flag state. |
| Queue | `server/services/queue.service.ts`, `server/workers/webhook-worker.ts` | Add a separate `HISTORICAL_SCAN` queue and worker. |
| Existing dashboard UI | `client/src/pages/dashboard.tsx:580-648` | Add first-run scan state above current empty/flagged table. |
| Existing flag display | `client/src/pages/dashboard.tsx` | Reuse table/modal; only add scan-state/card UI. |

---

## Task 1: Make duplicate time windows historical-safe

**Objective:** Ensure an imported order is compared only against orders within the configured window preceding *that imported order*, not against the current clock.

> **Why an upper bound too:** every candidate query in `findDuplicates` currently uses only `gte(orders.createdAt, timeThreshold)` with no upper bound. Anchoring the threshold to `newOrder.createdAt` fixes the lower bound, but a historical order would still match against orders created *after* it (e.g., live webhook orders arriving while the scan runs). Both bounds must change.

**Files:**
- Modify: `server/services/duplicate-detection.service.ts:61-64` (threshold) and all three candidate queries (upper bound)
- Modify: `server/services/duplicate-detection.service.test.ts`

**Step 1: Write failing tests**

Add a test where `newOrder.createdAt` is 30 days ago and an existing matching order is 12 hours before it. The test must find the match even though both orders are older than the current time.

Add a second test where the candidate is outside the configured window before `newOrder.createdAt`; it must not match.

Add a third test where a matching candidate was created *after* `newOrder.createdAt` (e.g., 1 hour later); it must not match. Duplicates are always flagged on the newer order of a pair, never the older one.

**Step 2: Verify red**

Run:
```bash
npm test -- server/services/duplicate-detection.service.test.ts
```
Expected: new historical test fails with no match because the service anchors `timeThreshold` to `new Date()`.

**Step 3: Implement the minimal fix**

Replace the current reference with a defensive clone of the order timestamp:
```ts
const referenceTime = newOrder.createdAt ? new Date(newOrder.createdAt) : new Date();
const timeThreshold = new Date(referenceTime);
timeThreshold.setHours(timeThreshold.getHours() - settings.timeWindowHours);
```

Then add `lte(orders.createdAt, referenceTime)` alongside the existing `gte(orders.createdAt, timeThreshold)` in all three candidate queries (email, phone, and the shared time-window query in `loadOrdersInWindow`). Also exclude the order being analyzed itself: `ne(orders.shopifyOrderId, newOrder.shopifyOrderId)`, so a webhook retry or scan re-run never matches an order against its own persisted row.

**Step 4: Verify green**

Run the focused test, then:
```bash
npm run check
```

**Step 5: Commit**
```bash
git add server/services/duplicate-detection.service.ts server/services/duplicate-detection.service.test.ts
git commit -m "fix: anchor duplicate window to order timestamp"
```

## Task 2: Extract Shopify-order mapping into a shared pure service

**Objective:** Make live webhook payloads and historical API payloads produce the exact same internal `InsertOrder` shape.

**Files:**
- Create: `server/services/order-mapper.service.ts`
- Create: `server/services/order-mapper.service.test.ts`
- Modify: `server/services/webhook-processor.service.ts:179-209`

**Step 1: Write failing mapper tests**

Cover email/contact email fallback, customer-name assembly, phone source precedence, shipping address, line items, price/currency, and preservation of Shopify `created_at`.

**Step 2: Verify red**
```bash
npm test -- server/services/order-mapper.service.test.ts
```
Expected: module does not exist.

**Step 3: Implement `mapShopifyOrder`**

```ts
export function mapShopifyOrder(shopDomain: string, shopifyOrder: any): InsertOrder {
  return {
    shopDomain,
    shopifyOrderId: String(shopifyOrder.id),
    orderNumber: shopifyOrder.order_number?.toString() || shopifyOrder.name || String(shopifyOrder.id),
    customerEmail: shopifyOrder.email || shopifyOrder.contact_email || null,
    customerName: shopifyOrder.customer
      ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim() || "Unknown"
      : "Unknown",
    customerPhone: shopifyOrder.phone || shopifyOrder.customer?.phone || shopifyOrder.billing_address?.phone || shopifyOrder.shipping_address?.phone || null,
    shippingAddress: shopifyOrder.shipping_address || null,
    lineItems: (shopifyOrder.line_items || []).map((item: any) => ({
      id: String(item.id),
      sku: item.sku ?? null,
      title: item.title ?? "",
      quantity: item.quantity ?? 0,
      price: item.price ?? "0.00",
    })),
    totalPrice: shopifyOrder.total_price || "0.00",
    currency: shopifyOrder.currency || "USD",
    createdAt: new Date(shopifyOrder.created_at || new Date()),
    isFlagged: false,
  };
}
```
Adjust types to match `InsertOrder` precisely; do not introduce `any` outside the unavoidable third-party payload boundary. Line items must be mapped field-by-field as above — Shopify REST line-item `id` values are numeric, while the schema's `lineItems` type requires `id: string`; assigning raw `line_items` would persist numbers into the jsonb column.

> **Guard the "Unknown" name in matching (required before any batch scan):** `calculateMatch` adds +20 confidence for equal customer names, and every customer-less order maps to `"Unknown"`. In a dense 60-day batch this is a false-positive amplifier: with SKU matching enabled, same SKU (+50) plus `"Unknown" === "Unknown"` (+20) reaches the 70-point flag threshold with no real customer signal, flagging unrelated guest orders that bought the same popular item. In `duplicate-detection.service.ts`, skip the name bonus when either name is empty or `"Unknown"` (case-insensitive), and add a test asserting two customer-less orders sharing only a SKU do not get flagged.

**Step 4: Replace inline webhook mapping** with this mapper.

**Step 5: Verify green**
```bash
npm test -- server/services/order-mapper.service.test.ts server/services/webhook-processor.service.test.ts
npm run check
```

**Step 6: Commit**
```bash
git add server/services/order-mapper.service.ts server/services/order-mapper.service.test.ts server/services/webhook-processor.service.ts
git commit -m "refactor: share Shopify order mapper"
```

## Task 3: Introduce one shared order processor with explicit modes

**Objective:** Separate analysis/persistence from side effects.

**Files:**
- Create: `server/services/order-processing.service.ts`
- Create: `server/services/order-processing.service.test.ts`
- Modify: `server/services/webhook-processor.service.ts`
- Modify: `shared/schema.ts` + a committed Drizzle migration (`npm run db:generate`) — add to `orders`: `flagSource` (`varchar`, `live | historical`, default `live`) and `flaggedByScanRunId` (nullable varchar). These must land here, not in Task 5, or this task's processor cannot persist provenance and `npm run check` cannot pass independently. They drive the dismiss-route behavior (Task 6), run-scoped group counting (Task 5), and stats exclusions (Task 7).

**Step 1: Write failing mode tests**

Test the following matrix with mocks for storage, `shopifyService`, `notificationService`, and `subscriptionService`:

| Mode | Persists order | Detects match | Tags Shopify | Sends notification | Consumes quota / increments count |
|---|---:|---:|---:|---:|---:|
| live | yes | yes | yes when flagged | yes when flagged | yes |
| historical | yes | yes | never | never | never |

**Step 2: Verify red**
```bash
npm test -- server/services/order-processing.service.test.ts
```
Expected: module does not exist.

**Step 3: Implement the mode contract**

```ts
export type ProcessOrderOptions =
  | { mode: "live" }
  | { mode: "historical"; scanRunId: string };

export async function processOrder(
  order: InsertOrder,
  accessToken: string,
  options: ProcessOrderOptions,
): Promise<{ order: Order; match: DuplicateMatch | null }> { /* ... */ }
```

Derive *all* side-effect behavior (tagging, notifications, quota) from `mode` inside the implementation rather than exposing per-effect booleans. The discriminated union makes invalid combinations like "historical but tags Shopify" unrepresentable, and forces the caller to supply the `scanRunId` needed for `flaggedByScanRunId` provenance.

**Historical scan-only matching profile:** The automatic first scan must not inherit live defaults that leave SKU matching disabled. Pass an in-memory profile to duplicate detection for historical mode with email, address, and SKU matching enabled. Enable phone matching in the profile as well; the matcher already uses it only when usable phone data is present. Merge this profile over the stored settings for the individual detection call only—never update the merchant's persisted live settings. Keep the merchant's configured time window unchanged.

Acceptance fixtures for the scan profile:

| Pair | Expected result |
|---|---|
| Different email, same normalized address, same sample SKU | One duplicate-looking group from address + SKU |
| Different email and name, same address only | No group at the 70-point threshold |
| Same email and name, no matching address | One duplicate-looking group from email + name |

Implementation sequence:
1. Check for an existing row by Shopify order ID.
   - **Live mode:** if it exists, keep today's behavior (skip; re-ensure tag if flagged).
   - **Historical mode:** if it exists and is unflagged and unresolved, *re-analyze* it — a live webhook may have persisted this order before the scan imported its older match, so its original analysis ran against an incomplete history. Update flag fields on a new match. Never modify orders that are already flagged or have `resolvedAt`/`resolvedBy` set (dismissals must survive scans). Still no Shopify/notification/quota side effects.
2. In live mode only, check quota before analysis.
3. Call existing `findDuplicates`.
4. Persist the order with flag reason/confidence/linked order ID, `flagSource` (from `options.mode`), and — for historical flags — `flaggedByScanRunId = options.scanRunId`.
5. In live mode only, tag the Shopify order, notify, and increment duplicate count when a match is found.
6. Return the stored order and match for scan aggregation.

**Step 4: Simplify `WebhookProcessorService`** so it is an adapter for verified webhook delivery, token retrieval, optional customer enrichment, mapper invocation, and `processOrder(..., { mode: "live" })`. Keep its webhook-delivery idempotency behavior.

**Step 5: Verify green**
```bash
npm test -- server/services/order-processing.service.test.ts server/services/webhook-processor.service.test.ts
npm run check
```

**Step 6: Commit**
```bash
git add server/services/order-processing.service.ts server/services/order-processing.service.test.ts server/services/webhook-processor.service.ts shared/schema.ts migrations/
git commit -m "refactor: separate historical order processing from live side effects"
```

## Task 4: Add bounded Shopify historical-order retrieval

**Objective:** Fetch only the default available 60-day order window using the existing `read_orders` scope.

**Files:**
- Modify: `server/services/shopify.service.ts`
- Create: `server/services/shopify.service.test.ts` or extend the existing test file

**Step 1: Write failing tests** for a 60-day clamp, pagination, duplicate Shopify ID removal, request failure, and no request prior to the `created_at_min` cutoff.

**Step 2: Implement** `listOrdersCreatedSince(shopDomain, accessToken, since, until)` with the existing authenticated retry conventions (`fetchWithRetry`). Clamp against the frozen run timestamp, not the wall clock: `effectiveSince = max(since, until - 60 days)`, so a retried run keeps the exact same window as its first attempt.

Required REST specifics (each one silently breaks the scan if omitted):
- `status=any` — the endpoint defaults to `status=open`, which would skip closed/archived orders and make the "orders checked" count wrong.
- `limit=250` (the maximum) and cursor pagination via the `Link` response header: follow each returned `page_info` URL exactly as given — cursored requests only accept `limit`/`fields`, so only the first request carries the date filters.
- `created_at_max` set to the scan-request timestamp (the `until` argument) so the scan window is frozen and does not race live `orders/create` webhooks arriving mid-scan.
- Respect `429` responses / the `Retry-After` header between pages (REST bucket is ~2 requests/second).

This deliberately uses the REST Admin API even though Shopify has marked it legacy: the entire existing service (`getOrder`, `getCustomer`, `tagOrder`, webhooks) is REST on a pinned recent API version, and mixing in GraphQL for one endpoint adds a second payload shape the mapper would have to normalize. Revisit only if Shopify announces a REST orders-endpoint sunset date.

**Step 3: Keep only fields required by `mapShopifyOrder` and matching** (use the `fields` query param). Avoid logging full order payloads or payment data.

**Step 4: Verify**
```bash
npm test -- server/services/shopify.service.test.ts
npm run check
```

**Step 5: Commit**
```bash
git add server/services/shopify.service.ts server/services/shopify.service.test.ts
git commit -m "feat: fetch bounded historical Shopify orders"
```

## Task 5: Add scan-run persistence and queue worker

**Objective:** Keep the initial scan asynchronous, observable, and idempotent.

**Files:**
- Modify: `shared/schema.ts`
- Create: a committed Drizzle migration via `npm run db:generate` — **production runs committed migrations (`npm run db:migrate` in deploy), not schema push** (see `server/index-prod.ts:58`); without the migration file the feature deploys against a missing table.
- Modify: `server/storage.ts`
- Modify: `server/services/queue.service.ts`
- Modify: `server/index-dev.ts` and `server/index-prod.ts` — both entrypoints start workers explicitly (`webhookWorker.start()`); the new scan worker must be started in both or queued scans never run.
- Create: `server/services/historical-scan.service.ts`
- Create: `server/services/historical-scan.service.test.ts`
- Create: `server/workers/historical-scan-worker.ts`

**Step 1: Write failing tests** for:
- one run row per shop, including two concurrent run-creation calls (only one row may result — the DB unique constraint, not application logic, is the authority);
- a manual retry re-queues the *same* row (same `id`, `requestedAt`, window; `attemptCount` incremented) and never inserts a second row; concurrent retries resolve via the compare-and-set (one wins, the other sees already-queued);
- completed scan count aggregation, including orders flagged by a prior failed attempt of the same run;
- `{ mode: "historical", scanRunId }` passed to every imported order;
- a fetch failure resulting in `failed` status;
- run creation followed by enqueue failure resulting in `failed`, not a stuck `queued` row;
- the reconciliation sweep marking a stale `running` run with no viable pg-boss job as `failed`;
- no call to tag, notify, or quota methods.

**Step 2: Add `historical_scan_runs` persistence**:

`id`, `shopDomain`, `status` (`queued|running|completed|failed`), `requestedAt`, `statusUpdatedAt`, `startedAt`, `completedAt`, `windowDays`, `attemptCount`, `ordersFetched`, `ordersImported`, `matchesFound`, `candidateCapExceeded` (boolean), and `errorMessage`.

**One persistent logical run per shop:** enforce a plain unique constraint on `shopDomain` (not a status-scoped partial index). A shop's run row is created once; every retry reuses it. This is what makes the single `flaggedByScanRunId` column sufficient without an association table — orders flagged by a failed attempt keep pointing at the same run `id` that the retry completes.

Run-state rules:
- Create the row as `queued` (unique constraint makes concurrent creation safe — the loser treats the conflict as "run already exists"), then enqueue; if enqueueing throws, mark the row `failed` immediately.
- Retry = atomic compare-and-set on the same row: `UPDATE ... SET status = 'queued', statusUpdatedAt = now(), attemptCount = attemptCount + 1, startedAt = NULL, completedAt = NULL, errorMessage = NULL WHERE id = ... AND status = 'failed'`; zero rows updated means a concurrent retry won, respond as already-queued. `requestedAt` and the frozen window are never changed. Update `statusUpdatedAt` on every status transition; reconciliation must use it rather than immutable `requestedAt`.
- While pg-boss retries remain, a crashed attempt may leave the row `running` — the worker treats picking up a job whose run is already `running` as a resume.
- A hard crash can mean no handler ever runs a final `catch`, so a `failed` transition needs an observer. Add a reconciliation sweep in the scan worker (on startup and on an interval, e.g. every 10 minutes): find runs stuck in `queued`/`running` whose `statusUpdatedAt` is older than the job expiry plus retry budget, verify no viable pg-boss job exists for them, and mark them `failed`. Without this, a crashed worker leaves the merchant polling `running` forever. A newly retried run must not be considered stale merely because its immutable `requestedAt` is old.

**Step 3: Add `HISTORICAL_SCAN` queue + worker** following the existing `ORDERS_CREATE` worker registration pattern.

> **Queue options matter here:** `queueService.addJob` defaults to `expireInMinutes: 15` with 3 retries. A sequential scan of a busy shop (each order runs several DB queries) can exceed 15 minutes, get expired by pg-boss, and be retried mid-run. Enqueue scan jobs with a generous expiry (e.g., `expireInMinutes: 120`) and `singletonKey: shopDomain` so the queue itself also enforces one active scan per shop. The scan flow must remain safe to re-run: `processOrder` in historical mode handles already-persisted orders idempotently (skip if flagged/resolved, re-analyze otherwise — see Task 3).

**Step 4: Implement scan flow**

1. Mark run `running` (record `startedAt`; if resuming after a retry, this is idempotent).
2. Load/refresh the shop’s existing offline access token.
3. Fetch the default 60-day window with `created_at_max` = the run’s `requestedAt`.
4. Sort orders oldest → newest.
5. Map each payload with `mapShopifyOrder`.
6. Call `processOrder(mappedOrder, accessToken, { mode: "historical", scanRunId: run.id })` sequentially so each later order can compare against earlier persisted orders.
7. Compute `matchesFound` at the end by loading the run's flagged orders (`flaggedByScanRunId = run.id`) and counting **connected components** over the `order → duplicateOfOrderId` links (union-find over the pairs). Counting distinct `duplicateOfOrderId` values over-counts chains: C→B and B→A is one group of three, not two groups. Querying at completion instead of incrementing in memory also keeps the count correct when a retried run skips already-imported orders.
8. Track candidate-cap truncation: `findDuplicates` caps fuzzy address/SKU candidates at `FUZZY_CANDIDATE_LIMIT` (500, `duplicate-detection.service.ts:9`), and a busy promotion can exceed 500 orders inside one matching window. Detect truncation precisely by querying `FUZZY_CANDIDATE_LIMIT + 1` candidates and checking whether more than the limit came back — receiving exactly 500 rows does not prove anything was cut off. Surface this via return metadata and set the run's `candidateCapExceeded` boolean (idempotent across retries, unlike a counter). If set, treat the scan as partial: the dashboard copy must not claim an exhaustive check. Do not switch to an uncapped matcher — the cap bounds memory; report honestly instead.
9. Mark run `completed` with counts; on error, mark `failed` without exposing raw Shopify responses to the merchant.
10. Add `historical_scan_runs` rows to the existing uninstall cleanup in `server/storage.ts` so scan history is deleted with the rest of the shop’s data.

**Step 5: Verify green**
```bash
npm test -- server/services/historical-scan.service.test.ts
npm test
npm run check
```

**Step 6: Commit**
```bash
git add shared/schema.ts migrations/ server/storage.ts server/services/queue.service.ts server/services/historical-scan.service.ts server/services/historical-scan.service.test.ts server/workers/historical-scan-worker.ts server/index-dev.ts server/index-prod.ts
git commit -m "feat: queue read-only historical duplicate scan"
```

## Task 6: Add authenticated scan API and first-run auto-start

**Objective:** Start a first historical scan immediately after onboarding without blocking OAuth or a dashboard request.

**Files:**
- Modify: `server/routes.ts`
- Modify: `server/shopify-auth.ts` — the OAuth completion lives in `authCallback` (`server/shopify-auth.ts:278`), not in `routes.ts`; this is where post-install auto-start hooks in
- Add/extend route tests

**Step 1: Add `GET /api/historical-scan/latest`** for the authenticated shop.

**Step 2: Add `POST /api/historical-scan`**:
- ignores client-provided day ranges;
- no run row yet → create the shop's single run row and enqueue it (a unique-constraint violation from a concurrent request means the other request won — respond as if the run already existed);
- run in `queued|running` → `409`;
- run in `failed` → retry in place via the Task 5 compare-and-set and re-enqueue; run in `completed` → `409` in v1 (re-scan is not a v1 feature);
- returns only safe run status/count fields.

**Step 3: Auto-create one scan after a successful first install** in `authCallback`, after session storage succeeds, without blocking the OAuth redirect (fire-and-forget with error logging). If post-auth auto-start is not reliable, have dashboard mount call `POST` exactly once when no run exists; use server idempotency as the authority.

**Step 4: Make dismissal safe for historical findings.** The existing dismiss route (`server/routes.ts:617`) unconditionally calls `shopifyService.removeOrderTag` — a Shopify order PUT. Historical findings were never tagged, so this write both violates the read-only promise and mutates an order's tags for no reason. Skip the Shopify tag-removal call when the order's `flagSource` is `historical`; keep the local dismissal and audit log identical for both sources. Add a test asserting a historical dismiss performs no Shopify call.

**Step 5: Verify** route authorization, one-run behavior, and no scan for an unauthenticated/cross-shop request.

**Step 6: Commit**
```bash
git add server/routes.ts server/shopify-auth.ts
git commit -m "feat: start first historical scan after install"
```

## Task 7: Show immediate scan proof in the existing dashboard

**Objective:** Replace the confusing “waiting for your first order” judgment point with scan progress/results.

**Files:**
- Create: `client/src/components/HistoricalScanCard.tsx`
- Modify: `client/src/pages/dashboard.tsx:580-648`
- Add component/API tests if supported by existing test setup

**Step 1: Add React Query polling** for `/api/historical-scan/latest` while status is `queued` or `running`.

**Step 2: Render these exact state shapes**:

| API state | Merchant-facing state |
|---|---|
| no run | `Checking your recent orders is ready` + start/retry control |
| queued/running | `Scanning your recent orders…` |
| completed, matches > 0 | `237 orders checked · 4 duplicate-looking groups found` |
| completed, matches = 0 | `237 orders checked · no duplicate-looking matches found` |
| completed, `candidateCapExceeded` | same counts, but qualified (e.g. `high-volume periods partially checked`) — never claim an exhaustive check |
| failed | `We couldn’t complete the recent-order scan` + safe retry/support control |

Use real counts. Do not call a group a fraud finding and do not say every matching order violated a promotion.

**Step 3: On completion, invalidate existing dashboard stats and flagged-order queries** so current table/modal displays the imported matches with no separate result UI.

**Step 4: Keep live monitoring copy** below the result: future new orders continue to be checked normally.

> **Known stats side effect:** imported matches are persisted with `flaggedAt = now`, so dashboard stats (`ordersFlaggedToday`, the 7-day trend) will count the whole backlog as today's activity right after a scan. This is acceptable for the first-run proof moment, but treat it as a deliberate choice — if the trend cards look broken in the dev-shop verification, exclude `flagSource = 'historical'` rows from the trend queries rather than changing `flaggedAt`.

**Step 5: Verify manually** in a development shop with a known same-address + same-SKU pair and a known zero-match fixture.

**Step 6: Commit**
```bash
git add client/src/components/HistoricalScanCard.tsx client/src/pages/dashboard.tsx
git commit -m "feat: show immediate historical scan proof"
```

## Task 8: Add campaign analytics and launch safeguards

**Objective:** Measure activation before sourcing 30–50 merchants.

**Files:**
- Create a minimal analytics helper — **no client analytics utility exists in `client/src` today** (no gtag/posthog/plausible/custom tracker). Simplest v1: emit these as structured server-side log events (or rows in a small `analytics_events` table) at the points where the scan run changes state and where the dashboard fetches a completed result; a client-side tracker is not required to measure this funnel.
- Create: `outputs/reports/2026-07-11-growth-reset.md` (this file does not exist yet; create the directory and report as part of this task)
- Create: `outreach/free-duplicate-exposure-scan-leads.csv` only after the feature is verified

**Events:**
- `historical_scan_started`
- `historical_scan_completed` with count buckets only, never PII
- `historical_scan_failed`
- `historical_scan_results_viewed` — deduplicate per scan run; the dashboard polls `GET /api/historical-scan/latest`, so emitting on every completed-result response would overcount views

**Campaign gates:**
- The feature is deployed and verified in a development shop.
- **Protected Customer Data access is verified on the production app:** bulk `orders.json` responses only include customer email/phone/name/shipping address if the app’s PCD access is approved. Without it, historical matching silently degrades to SKU-only and the scan under-reports. Confirm a fetched historical order contains email + shipping address before announcing the offer.
- UI says `duplicate-looking` / `review`, never `bypass confirmed` / `fraud found`.
- The live free-sample landing page links to the exact App Store install path.
- Each prospect is active, Shopify-hosted, currently running a free sample, one-per-household/one-per-customer, or limited-drop promotion, and has a direct public contact route.
- Drafts remain approval-gated; no auto-send.

**Measurement:** outreach-to-install, install-to-scan-completion, share with ≥1 match, and 14-day retained installation.

## Final verification checklist

- [ ] `npm run check` passes.
- [ ] `npm test` passes.
- [ ] Default 60-day cutoff is enforced without `read_all_orders`.
- [ ] An old historical pair inside the configured time window matches based on `newOrder.createdAt`.
- [ ] An old pair outside that window does not match.
- [ ] An order never matches a candidate created after it (upper bound), and never matches its own persisted row.
- [ ] Historical fetch uses `status=any` and a frozen `created_at_max`; closed/archived orders are included in the checked count.
- [ ] The scan job is enqueued with an extended expiry and per-shop `singletonKey`; a retried run produces correct counts.
- [ ] A committed Drizzle migration exists for all schema changes, and the scan worker is started in both `index-dev.ts` and `index-prod.ts`.
- [ ] Concurrent scan-creation requests produce exactly one run row per shop (unique constraint verified).
- [ ] A retry after `failed` reuses the same run row and window; orders flagged by the earlier attempt appear in the final counts.
- [ ] A run orphaned by a worker crash is reconciled to `failed` and becomes retryable; the dashboard never polls `running` forever.
- [ ] `matchesFound` counts connected components of duplicate links, matching the "N duplicate-looking groups" copy (a C→B→A chain is one group).
- [ ] A cap-hit scan is reported as partial, not exhaustive.
- [ ] Dismissing a historical finding performs no Shopify API call; dismissing a live finding still removes the tag.
- [ ] Orders persisted by live webhooks mid-scan are re-analyzed by the scan; dismissed orders are never re-flagged.
- [ ] Two customer-less ("Unknown"-name) orders sharing only a SKU are not flagged.
- [ ] Historical detection uses the scan-only email + address + SKU profile without mutating stored live settings; phone is considered only when data is available.
- [ ] The three controlled scan-profile fixtures pass: address + SKU flags an email change, address alone does not, and same email + name flags without an address match.
- [ ] Historical mode never tags Shopify, sends notifications, checks/consumes quota, or increments duplicate counts.
- [ ] Completed scan populates the existing dashboard flagged-order table.
- [ ] A zero-match scan plainly says it completed.
- [ ] Uninstall cleanup still removes imported shop data, including `historical_scan_runs` rows.
- [ ] The first campaign email is not drafted/sent until a controlled scan has verified the end-to-end result.
