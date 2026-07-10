# Persistent Quota Header Badge Implementation Plan

> **For Hermes:** Use software-development-lifecycle to implement this plan task-by-task. Keep the existing dashboard quota banner; add a lighter persistent header-level status so merchants can see quota trouble from any page.

**Goal:** Add a persistent header badge that warns free-plan merchants when they are near or over the duplicate-flag limit, with a clear upgrade path.

**Architecture:** Reuse the existing `/api/subscription` data already consumed by `QuotaWarningBanner` and the subscription page. Add a small pure helper for quota status, then render a compact badge in `Header` on desktop and mobile. Keep the existing full-width dashboard banner as the detailed explanation; the header badge is a persistent, lower-footprint cue across Dashboard, Settings, Subscription, and Support.

**Tech Stack:** React 18, TypeScript, TanStack Query, Wouter, shadcn/ui Button/Badge patterns, Vitest, Vite.

**Base verified before planning:** Ran `git fetch origin main` and `git pull --rebase --autostash origin main` in `code/OrderAuditor`; result was `Already up to date` on branch `main` at `035bdb3 Run landing SEO index during image build`. Existing dirty file before/after pull: `server/services/duplicate-detection.service.test.ts` with unrelated local test changes; do not touch it for this feature.

---

## Existing behavior

- Full dashboard quota banner exists in `client/src/components/QuotaWarningBanner.tsx`.
- It is rendered only on the dashboard at `client/src/pages/dashboard.tsx:625`.
- It warns at `>=80%` and shows a destructive limit-reached alert at `>=100%`.
- The production bundle already contains this banner copy, so this plan is for broader visibility, not for initial quota alert implementation.

## Acceptance criteria

- Free-plan merchants see a persistent header badge on every app page when usage is `>=80%`.
- `80–99%`: badge says `Limit soon` or equivalent, visually amber/warning.
- `>=100%`: badge says `Limit reached`, visually destructive/red.
- Paid/unlimited merchants see no quota badge.
- Clicking the badge opens `/subscription` while preserving the existing Shopify query string (`shop`, `host`, etc.).
- Mobile header still has a visible quota cue, not hidden only inside the side sheet.
- Existing dashboard banner remains unchanged or only imports shared helper; no duplicate quota math drift.
- `npm run check`, targeted Vitest tests, and `npm run build` pass.

---

### Task 1: Create shared quota status helper

**Objective:** Avoid duplicating quota threshold logic across dashboard banner, subscription page, and header.

**Files:**
- Create: `client/src/lib/quotaStatus.ts`
- Test: `client/src/lib/quotaStatus.test.ts`

**Step 1: Add failing tests**

Create `client/src/lib/quotaStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getQuotaStatus } from "./quotaStatus";

describe("getQuotaStatus", () => {
  it("returns hidden when subscription is missing", () => {
    expect(getQuotaStatus(undefined)).toEqual({ state: "hidden" });
  });

  it("returns hidden for paid or unlimited plans", () => {
    expect(getQuotaStatus({ tier: "paid", monthlyOrderCount: 50, orderLimit: 50 })).toEqual({ state: "hidden" });
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 50, orderLimit: -1 })).toEqual({ state: "hidden" });
  });

  it("returns hidden below 80 percent", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 39, orderLimit: 50 })).toEqual({ state: "hidden" });
  });

  it("returns warning at 80 to 99 percent", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 40, orderLimit: 50 })).toMatchObject({
      state: "warning",
      usagePercentage: 80,
      remaining: 10,
    });
  });

  it("returns exceeded at 100 percent and clamps remaining to zero", () => {
    expect(getQuotaStatus({ tier: "free", monthlyOrderCount: 55, orderLimit: 50 })).toMatchObject({
      state: "exceeded",
      usagePercentage: 110,
      remaining: 0,
    });
  });
});
```

**Step 2: Run test to verify failure**

```bash
npm test -- client/src/lib/quotaStatus.test.ts
```

Expected: FAIL because `quotaStatus.ts` does not exist.

**Step 3: Implement helper**

Create `client/src/lib/quotaStatus.ts`:

```ts
export type QuotaSubscription = {
  tier: string;
  monthlyOrderCount: number;
  orderLimit: number;
  currentBillingPeriodEnd?: string | null;
};

export type QuotaStatus =
  | { state: "hidden" }
  | {
      state: "warning" | "exceeded";
      usagePercentage: number;
      remaining: number;
      used: number;
      limit: number;
      resetDate: Date | null;
    };

export function getQuotaStatus(subscription?: QuotaSubscription | null): QuotaStatus {
  if (!subscription || subscription.tier === "paid" || subscription.orderLimit === -1) {
    return { state: "hidden" };
  }

  if (subscription.orderLimit <= 0) {
    return { state: "hidden" };
  }

  const usagePercentage = (subscription.monthlyOrderCount / subscription.orderLimit) * 100;
  if (usagePercentage < 80) {
    return { state: "hidden" };
  }

  return {
    state: usagePercentage >= 100 ? "exceeded" : "warning",
    usagePercentage,
    remaining: Math.max(0, subscription.orderLimit - subscription.monthlyOrderCount),
    used: subscription.monthlyOrderCount,
    limit: subscription.orderLimit,
    resetDate: subscription.currentBillingPeriodEnd ? new Date(subscription.currentBillingPeriodEnd) : null,
  };
}
```

**Step 4: Run helper test**

```bash
npm test -- client/src/lib/quotaStatus.test.ts
```

Expected: PASS.

---

### Task 2: Refactor existing dashboard banner to use the helper

**Objective:** Keep existing dashboard behavior while centralizing threshold logic.

**Files:**
- Modify: `client/src/components/QuotaWarningBanner.tsx`
- Test: `client/src/lib/quotaStatus.test.ts`

**Step 1: Import helper**

In `QuotaWarningBanner.tsx`, import:

```ts
import { getQuotaStatus } from "@/lib/quotaStatus";
```

**Step 2: Replace local percentage/visibility logic**

Replace the current local checks:

```ts
const usagePercentage = (subscription.monthlyOrderCount / subscription.orderLimit) * 100;
if (usagePercentage < 80) return null;
const isExceeded = usagePercentage >= 100;
```

with:

```ts
const quotaStatus = getQuotaStatus(subscription);
if (quotaStatus.state === "hidden") {
  return null;
}

const isExceeded = quotaStatus.state === "exceeded";
const usagePercentage = quotaStatus.usagePercentage;
const resetDate = quotaStatus.resetDate
  ? quotaStatus.resetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  : null;
```

Update count references to use `quotaStatus.used` / `quotaStatus.limit` where possible.

**Step 3: Run tests and typecheck**

```bash
npm test -- client/src/lib/quotaStatus.test.ts
npm run check
```

Expected: PASS.

---

### Task 3: Add `QuotaHeaderBadge` component

**Objective:** Render a compact, persistent quota cue suitable for header placement.

**Files:**
- Create: `client/src/components/QuotaHeaderBadge.tsx`

**Implementation:**

```tsx
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { getQuotaStatus, type QuotaSubscription } from "@/lib/quotaStatus";

export function QuotaHeaderBadge() {
  const { data: subscription } = useQuery<QuotaSubscription>({
    queryKey: ["/api/subscription"],
    staleTime: 30000,
  });

  const quotaStatus = getQuotaStatus(subscription);
  if (quotaStatus.state === "hidden") {
    return null;
  }

  const search = window.location.search;
  const isExceeded = quotaStatus.state === "exceeded";
  const Icon = isExceeded ? AlertCircle : AlertTriangle;

  return (
    <Link href={`/subscription${search}`}>
      <Badge
        variant={isExceeded ? "destructive" : "outline"}
        className={
          isExceeded
            ? "h-8 cursor-pointer gap-1.5 px-2.5 text-xs"
            : "h-8 cursor-pointer gap-1.5 border-amber-500/60 bg-amber-500/10 px-2.5 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
        }
        data-testid={isExceeded ? "quota-header-badge-exceeded" : "quota-header-badge-warning"}
        title={`${quotaStatus.used} of ${quotaStatus.limit} duplicate flags used this cycle`}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">
          {isExceeded ? "Limit reached" : "Limit soon"}
        </span>
        <span className="sm:hidden">
          {isExceeded ? "Limit" : `${Math.round(quotaStatus.usagePercentage)}%`}
        </span>
      </Badge>
    </Link>
  );
}
```

**Design notes:**
- Keep text short so the header does not crowd nav.
- Use `title` as a low-cost detail on desktop.
- Do not add another full alert here; the dashboard/subscription pages already explain details.

---

### Task 4: Render badge in desktop and mobile header

**Objective:** Make quota state visible on all app pages without requiring dashboard visit.

**Files:**
- Modify: `client/src/components/Header.tsx`

**Step 1: Import component**

```tsx
import { QuotaHeaderBadge } from "@/components/QuotaHeaderBadge";
```

**Step 2: Add badge next to desktop nav / mobile menu**

Change the right side layout from separate desktop/mobile blocks to a single right cluster:

```tsx
<div className="flex items-center gap-2">
  <QuotaHeaderBadge />

  {/* Desktop Nav */}
  <nav className="hidden md:flex gap-2">
    <NavLinks />
  </nav>

  {/* Mobile Nav */}
  <div className="md:hidden">
    ...existing Sheet...
  </div>
</div>
```

Keep the existing nav links and query-string behavior unchanged.

**Step 3: Run typecheck**

```bash
npm run check
```

Expected: PASS.

---

### Task 5: Add a subscription-page top alert for consistency

**Objective:** If a merchant clicks the header badge, the destination should immediately explain what happened.

**Files:**
- Modify: `client/src/pages/subscription.tsx`

**Step 1: Import helper**

```ts
import { getQuotaStatus } from "@/lib/quotaStatus";
```

**Step 2: Reuse helper after subscription-derived constants**

After `remainingDuplicateFlags`:

```ts
const quotaStatus = getQuotaStatus(subscription);
```

**Step 3: Add top-of-page alert before the plan grid**

Insert before `<div className="grid gap-6 md:grid-cols-2">`:

```tsx
{quotaStatus.state !== "hidden" && (
  <Alert
    className={
      quotaStatus.state === "exceeded"
        ? "mb-6 border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive"
        : "mb-6 border-amber-500/50 bg-amber-500/10"
    }
  >
    <AlertCircle className="h-4 w-4" />
    <AlertDescription>
      {quotaStatus.state === "exceeded"
        ? "Your free duplicate flag limit has been reached. New duplicate-looking orders will not be tagged or flagged until the usage cycle resets."
        : `You have used ${Math.round(quotaStatus.usagePercentage)}% of your free duplicate flags this cycle.`}
    </AlertDescription>
  </Alert>
)}
```

**Step 4: Replace local alert branch with helper if desired**

Optional but preferred: replace the existing `usagePercentage >= 100` / `>=90` alert branch inside the current plan card with `quotaStatus.state`. Keep copy DRY and thresholds consistent.

---

### Task 6: Verify locally

**Objective:** Prove the implementation is safe before review/deploy.

**Commands:**

```bash
npm test -- client/src/lib/quotaStatus.test.ts
npm run check
npm run build
```

Expected:
- targeted quota tests pass
- TypeScript passes
- Vite/esbuild production build passes

**Manual QA checklist:**

Run dev server if needed:

```bash
npm run dev
```

Then verify with mocked/dev subscription states or temporary local API fixture:

- [ ] Free plan `39/50`: no header badge, no dashboard banner.
- [ ] Free plan `40/50`: amber header badge visible on `/`, `/settings`, `/subscription`, `/support`; dashboard banner visible on `/`.
- [ ] Free plan `50/50`: red/destructive header badge visible on all pages; dashboard banner says new duplicate-looking orders will not be tagged/flagged.
- [ ] Paid plan `orderLimit = -1`: no header quota badge.
- [ ] Badge click preserves Shopify query string and opens `/subscription?shop=...&host=...`.
- [ ] Mobile width: badge remains visible next to hamburger, with compact text.

---

### Task 7: Review diff before implementation handoff

**Objective:** Avoid scope creep and protect unrelated local changes.

**Commands:**

```bash
git diff -- client/src/lib/quotaStatus.ts \
  client/src/lib/quotaStatus.test.ts \
  client/src/components/QuotaWarningBanner.tsx \
  client/src/components/QuotaHeaderBadge.tsx \
  client/src/components/Header.tsx \
  client/src/pages/subscription.tsx

git status --short
```

Expected:
- Only the planned quota/header files are changed for this feature.
- Existing unrelated dirty file `server/services/duplicate-detection.service.test.ts` remains untouched unless separately approved.

---

## Deployment note

Do not restart or redeploy automatically without approval. After implementation and review, deploy through the normal Duplicate Guard/Coolify path and verify the production bundle contains `Limit reached` and the badge test IDs, similar to the previous deployed-bundle grep check.
