# Duplicate Guard Billing Hardening Delta Plan

> **For Hermes:** Implement with RED-GREEN-REFACTOR and code review. Reuse the existing billing lifecycle; do not build a second subscription system.

**Goal:** Close the remaining duplicate-charge race, reconcile historical local billing drift safely, and repair verified customer state without duplicating protections already shipped.

**Architecture:** Keep the current `handleExistingCharges`, charge-ID persistence, webhook idempotency, and stale-terminal-event guards. Add one cross-process lock around the existing check-and-create block, one authoritative Shopify billing snapshot method for positive reconciliation and exact period dates, and one dry-run-first repair command that reuses those services.

**Tech Stack:** TypeScript, Express, PostgreSQL/node-postgres, Shopify Admin GraphQL 2025-10, Vitest.

---

## What already exists and should be reused

### Existing-charge reuse

Commit `d24f6dc` from 2025-12-16 added the current preflight:

- `shopifyBillingService.handleExistingCharges()` lists charges.
- Existing `PENDING` charge confirmation URLs are reused.
- Existing `ACTIVE` charges are returned instead of creating another.

Current files:

- `server/routes.ts:2233-2276`
- `server/services/shopify-billing.service.ts:298-385`

This is correct but not atomic. Two requests can both list before either creates, so the remaining gap is only the check-then-create race.

### Charge-ID-aware webhook hardening

Commit `fc3a306` from 2026-06-16 added:

- parsing Shopify app-subscription IDs;
- storing the approved charge ID locally;
- ignoring terminal events for a different charge ID;
- syncing `ACTIVE` webhooks to paid access.

Commit `13f8e99` from 2026-06-21 added:

- ignoring `EXPIRED` pending-charge webhooks when no active charge ID was stored;
- preserving paid `active`, `complimentary`, and `frozen` records from ambiguous pending-charge expirations.

Current files:

- `server/utils/app-subscription.ts`
- `server/services/subscription.service.ts:119-248`
- `server/utils/app-subscription.test.ts`
- `server/services/subscription.service.test.ts:265-390`

### Webhook idempotency

The current webhook route atomically records Shopify delivery IDs using the unique `(shop_domain, delivery_id)` index before processing `app_subscriptions/update`.

Current files:

- `shared/schema.ts:183-209`
- `server/routes.ts:1446-1510`
- `server/storage.ts` delivery insertion helpers

### Existing positive sync paths

The code already promotes local state when it sees an active charge:

- upgrade preflight calls `activatePaidSubscription`;
- activation calls `activatePaidSubscription`;
- `ACTIVE` webhooks call `activatePaidSubscription`;
- OAuth/reinstall calls `handleExistingCharges`.

Do not replace these paths. Extend them to persist Shopify's authoritative period end.

### Verification of current protections

Executed on 2026-07-20:

```bash
npm test -- server/utils/app-subscription.test.ts \
  server/services/subscription.service.test.ts \
  server/services/shopify-billing.service.test.ts
```

Result: **3 test files passed, 32 tests passed**.

---

## Incident timing conclusion

The two observed stores predate or overlap the hardening:

- **SereniVida Chile:** duplicate charges created 2026-03-20, almost three months before charge-ID-aware webhook hardening.
- **T2G:** duplicate charges created 2026-06-13. The stale expiry arrived 2026-06-16 at 13:12 CEST; the first guard commit landed at 16:21 CEST the same day, about three hours later. The stronger no-stored-ID guard landed 2026-06-21.

Therefore:

- Their stale expiry/downgrade history is **not evidence that the current webhook guard still fails**.
- SereniVida's local-free/Shopify-active state is historical damage that current code does not automatically discover unless an active-charge sync path runs.
- The duplicate charge creation race is still possible because the current preflight is not serialized.
- Exact billing-period reconciliation is still absent.

---

## Acceptance criteria

- Concurrent upgrade requests for one shop call Shopify charge creation exactly once.
- Existing pending/active charge reuse remains unchanged.
- All 32 existing billing/subscription tests continue passing.
- Terminal webhooks for stale charge IDs never downgrade a different active charge.
- A successful Shopify read with exactly one active subscription can repair local tier, status, limit, charge ID, and period end.
- Shopify auth/API failures make no local changes.
- Multiple active charges produce a diagnostic and no automatic mutation.
- SereniVida can be repaired through tested application code after approval.
- T2G's local period end can be synchronized through the same path.
- `d8b1c2.myshopify.com` remains unchanged until its Shopify billing status is verifiable.

---

### Task 1: Add a regression test for the remaining concurrent-create race

**Objective:** Prove the current check-then-create flow can create twice before fixing it.

**Files:**
- Create: `server/utils/shop-billing-lock.test.ts`
- Modify: `server/services/shopify-billing.service.test.ts`
- Modify the smallest extract from `server/routes.ts:2233-2276` needed for isolated testing.

**Steps:**

1. Mock `handleExistingCharges` so two concurrent calls both initially see no charge.
2. Hold the first mocked create request while the second enters.
3. Assert the current behavior calls `createRecurringCharge` twice.
4. Run the focused test and confirm RED.

```bash
npm test -- server/utils/shop-billing-lock.test.ts server/services/shopify-billing.service.test.ts
```

Expected before implementation: concurrency assertion fails.

---

### Task 2: Serialize only the existing check-and-create block

**Objective:** Close the race without replacing existing billing logic.

**Files:**
- Create: `server/utils/shop-billing-lock.ts`
- Modify: `server/routes.ts:2233-2276`
- Modify: `server/utils/shop-billing-lock.test.ts`

**Implementation:**

Use the existing `pool` from `server/db.ts` and a PostgreSQL advisory lock keyed by shop:

```ts
import { pool } from "../db";

export async function withShopBillingLock<T>(
  shop: string,
  operation: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('duplicate-guard-billing'), hashtext($1))",
      [shop.toLowerCase()],
    );
    return await operation();
  } finally {
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('duplicate-guard-billing'), hashtext($1))",
        [shop.toLowerCase()],
      );
    } finally {
      client.release();
    }
  }
}
```

Wrap the entire existing sequence—not just charge creation:

1. `handleExistingCharges`
2. reuse pending charge if present
3. return active charge if present
4. create only when neither exists

After the first request releases the lock, the second request must list again and reuse the pending charge.

**Tests:**

- same-shop calls serialize;
- different shops do not share a lock key;
- lock releases after success and exception;
- concurrent same-shop flow performs one create.

```bash
npm test -- server/utils/shop-billing-lock.test.ts server/services/shopify-billing.service.test.ts
```

Expected: PASS.

---

### Task 3: Add authoritative period-aware billing snapshot retrieval

**Objective:** Fill only the missing source-of-truth fields; preserve existing lifecycle handling.

**Files:**
- Modify: `server/services/shopify-billing.service.ts`
- Modify: `server/services/shopify-billing.service.test.ts`

**Implementation:**

Add `getBillingSnapshot(shop, accessToken)` using Shopify Admin GraphQL:

```graphql
query BillingSnapshot {
  currentAppInstallation {
    activeSubscriptions {
      id
      name
      status
      createdAt
      currentPeriodEnd
      test
    }
    allSubscriptions(first: 25, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        status
        createdAt
        currentPeriodEnd
        test
      }
    }
  }
}
```

Return a typed result. Throw/return a distinct `unverified` failure for HTTP errors, GraphQL errors, or malformed data. Never convert a failed request into an empty active list.

**Tests:**

- one active + historical expired;
- zero active after a successful response;
- multiple active;
- 401, timeout, 429, 5xx, and GraphQL error;
- malformed `currentPeriodEnd`;
- logs contain no tokens or full charge IDs.

```bash
npm test -- server/services/shopify-billing.service.test.ts
```

Expected: PASS.

---

### Task 4: Extend existing paid activation with authoritative period end

**Objective:** Reuse `activatePaidSubscription` instead of introducing a parallel state machine.

**Files:**
- Modify: `server/services/subscription.service.ts:119-157`
- Modify: `server/services/subscription.service.test.ts`

**Change:**

```ts
async activatePaidSubscription(
  shopDomain: string,
  shopifyChargeId?: string | number | null,
  accessToken?: string,
  currentPeriodEnd?: Date,
): Promise<Subscription>
```

When supplied, persist Shopify's exact `currentPeriodEnd`. Otherwise preserve current behavior. Do not set `now + 30 days` in this path.

**Tests:**

- stores charge ID and exact period end;
- omitted period end does not erase the existing value;
- existing stale-webhook and frozen-subscription tests remain green.

```bash
npm test -- server/services/subscription.service.test.ts server/utils/app-subscription.test.ts
```

Expected: PASS.

---

### Task 5: Add a narrow positive reconciliation helper

**Objective:** Repair verified active subscriptions while never guessing about zero-active or unverified stores.

**Files:**
- Create: `server/services/billing-reconciliation.service.ts`
- Create: `server/services/billing-reconciliation.service.test.ts`

**Decision table:**

| Shopify result | Local action |
|---|---|
| Exactly one active | Call existing `activatePaidSubscription` with ID and period end |
| Active + historical terminal charges | Same positive sync; terminal history does not override active |
| Multiple active | Log high severity; no mutation |
| Successfully verified zero active | Report `no_active`; no automatic mutation |
| 401/403/429/5xx/timeout/error | Report `unverified`; no mutation |

The service must return structured outcomes and log only shop plus charge suffixes.

**Tests:**

- local free + Shopify active becomes paid;
- local paid with wrong period is corrected;
- multiple/zero/unverified perform zero writes.

```bash
npm test -- server/services/billing-reconciliation.service.test.ts
```

Expected: PASS.

---

### Task 6: Extend existing sync points, not every request path

**Objective:** Use the new snapshot where billing work already occurs.

**Files:**
- Modify: `server/services/shopify-billing.service.ts:176-254,343-385`
- Modify: `server/routes.ts:2253-2268,2295-2317`
- Modify: `server/shopify-auth.ts:735-776`

**Changes:**

1. After successful activation, fetch the snapshot and persist exact period end.
2. When `handleExistingCharges` finds an active charge during upgrade or OAuth/reinstall, call the reconciliation helper rather than only `updateTier`.
3. If snapshot retrieval fails after activation, keep the already-approved local paid state and log that period reconciliation is pending.
4. Do **not** add automatic downgrade behavior to `/api/subscription` GET.

This is smaller and safer than the original plan's proposed always-on reconciliation path.

**Verification:**

```bash
npm test -- server/services/shopify-billing.service.test.ts \
  server/services/billing-reconciliation.service.test.ts \
  server/services/subscription.service.test.ts
npm run check
```

Expected: PASS and TypeScript exit 0.

---

### Task 7: Add client defense in depth

**Objective:** Prevent rapid duplicate clicks while retaining the server lock as the real guarantee.

**Files:**
- Modify: `client/src/pages/subscription.tsx`
- Add a small test only if the current Vitest setup supports it; do not add a new browser-test framework.

Use one immediate in-flight ref for every upgrade button and keep existing loading/disabled state:

```tsx
const upgradeInFlightRef = useRef(false);

const requestUpgrade = () => {
  if (upgradeInFlightRef.current || upgradeMutation.isPending) return;
  upgradeInFlightRef.current = true;
  upgradeMutation.mutate(undefined, {
    onSettled: () => {
      upgradeInFlightRef.current = false;
    },
  });
};
```

Run:

```bash
npm run check
npm run build
```

Expected: both exit 0.

---

### Task 8: Add a dry-run-first repair command

**Objective:** Repair historical drift through the tested service instead of ad hoc SQL.

**Files:**
- Create: `scripts/audit-billing-consistency.ts`
- Create: `scripts/audit-billing-consistency.test.ts`
- Modify: `package.json`

**Commands:**

```bash
npm run billing:audit
npm run billing:audit -- --shop=05be72-ae.myshopify.com
npm run billing:audit -- --shop=05be72-ae.myshopify.com --apply-active
```

**Rules:**

- dry-run by default;
- load tokens through existing refresh-aware session handling;
- `--apply-active` only for exactly one verified active subscription;
- no cancellation, deletion, or downgrade options;
- invalid sessions are `unverified`, never `no_active`;
- redact tokens and full charge IDs;
- reuse `billing-reconciliation.service.ts`.

**Tests:**

- dry-run writes nothing;
- apply-active syncs only verified one-active state;
- zero/multiple/unverified states refuse mutation.

```bash
npm test -- scripts/audit-billing-consistency.test.ts
npm run billing:audit -- --help
```

Expected: PASS; help exits 0 without DB access.

---

### Task 9: Verify, review, deploy, and selectively repair

**Code verification:**

```bash
npm test
npm run check
npm run build
git diff --check
git diff --stat main...HEAD
```

Review for:

- preservation of current webhook guards;
- lock release on all paths;
- no API-failure-to-downgrade path;
- no tokens/full charge IDs in output;
- no second billing state machine;
- no unapproved production mutation.

**Production actions require explicit approval:**

1. Deploy reviewed code.
2. Run `npm run billing:audit` in dry-run mode.
3. Apply verified positive repairs only:

```bash
npm run billing:audit -- --shop=05be72-ae.myshopify.com --apply-active
npm run billing:audit -- --shop=bfdc01.myshopify.com --apply-active
```

Expected:

- SereniVida: local `paid/active`, `orderLimit=-1`, active charge suffix `812260`, period end matching Shopify.
- T2G: active charge unchanged, period end synchronized.
- `d8b1c2.myshopify.com`: unchanged and reported as unverified.

Never cancel a Shopify charge or delete stale records as part of this repair.

---

## Final implementation order

1. Concurrent-create regression test.
2. Advisory lock around current check-and-create logic.
3. Shopify billing snapshot method.
4. Extend existing paid activation with period end.
5. Narrow positive reconciliation helper.
6. Extend current activation/upgrade/OAuth sync points.
7. Client duplicate-click guard.
8. Dry-run/apply-active audit command.
9. Full verification, review, approved deploy, selective repair.
