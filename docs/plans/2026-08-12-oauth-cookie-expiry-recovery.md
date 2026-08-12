# OAuth Cookie Expiry Recovery Implementation Plan

> **For Hermes:** Use the software-development lifecycle and implement this plan task-by-task with TDD and review before deployment.

**Goal:** Recover new Shopify installations when the SDK's 60-second OAuth state cookie expires, without weakening Shopify's HMAC/state validation or leaving merchants on a raw HTTP 500 page.

**Architecture:** Keep `@shopify/shopify-api` as the sole OAuth validator and token exchanger. When `shopify.auth.callback()` throws `CookieNotFound`, reject that expired callback as an authorization event and discard its code, HMAC, state, timestamp, host, and every other parameter except the shop value accepted by Shopify's sanitizer. Use that sanitized shop name to start one bounded, completely fresh SDK-managed OAuth flow. Track the retry in a small process-local TTL registry, then show a safe manual recovery page rather than looping if the fresh flow also expires.

**Tech Stack:** Express 4, TypeScript, `@shopify/shopify-api` 12.3, Vitest 4, existing Postgres session storage and structured logger.

---

## Scope and decisions

### In scope

- Detect Shopify SDK `CookieNotFound` separately from other callback errors.
- Restart OAuth once per shop within a 10-minute recovery window.
- Stop retry loops and render a merchant-safe recovery page on repeated failure.
- Preserve the existing SDK HMAC/state checks, offline-token exchange, session storage, webhook registration, billing reconciliation, and historical scan startup.
- Add structured, non-secret logs for initial recovery, repeated failure, and successful recovery.
- Add unit tests, typecheck, build, and a production smoke-test procedure.
- Treat the process-local registry only as UX loop protection: a restart clears it, replicas have independent state, and tabs for one shop share the local retry allowance. Bound it to 1,000 active entries and fall back to the safe manual recovery page if capacity is exhausted.

### Out of scope

- Patching `node_modules` to extend Shopify's hard-coded 60-second cookie.
- Reimplementing OAuth state, HMAC verification, or token exchange ourselves.
- Adding a database table solely for a rare retry guard.
- Contacting MuscleEase™ or Velion, reinstalling on their behalf, or deploying without approval.
- Treating a Partner `RELATIONSHIP_INSTALLED` event as proof that the app has an offline session.

### Why this approach

- The observed callbacks arrived 148.60s and 204.87s after OAuth began; the installed SDK expires `shopify_app_state` after 60s.
- A custom 10-minute server-side OAuth implementation would duplicate security-sensitive Shopify SDK behavior and increase maintenance risk.
- Once Shopify records the relationship as installed, restarting authorization should no longer require the merchant to spend minutes reviewing the original approval screen.
- A bounded retry fixes the user journey while retaining the SDK's security checks.
- The stale callback never provisions a merchant. Only the fresh callback can pass SDK state/HMAC validation, exchange a code, and enter the existing session/setup workflow.

---

### Task 1: Add a bounded OAuth recovery registry

**Objective:** Provide a testable one-retry-per-shop guard with automatic TTL expiry.

**Files:**
- Create: `server/utils/oauth-recovery.ts`
- Test: `server/utils/oauth-recovery.test.ts`

**Step 1: Write failing tests**

Cover these cases using an injected clock:

1. First failure for a sanitized shop returns `true` (automatic retry allowed).
2. Second failure inside 10 minutes returns `false` (loop stopped).
3. A failure after 10 minutes returns `true` again.
4. `clear(shop)` removes recovery state after a successful callback.
5. Shop keys are normalized to lowercase.

Suggested public API:

```ts
export class OAuthRecoveryRegistry {
  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  claimAutomaticRetry(shop: string): boolean;
  clear(shop: string): void;
}

export const oauthRecoveryRegistry = new OAuthRecoveryRegistry();
```

**Step 2: Verify the tests fail**

Run:

```bash
npx vitest run server/utils/oauth-recovery.test.ts
```

Expected: FAIL because the registry does not exist.

**Step 3: Implement the minimal registry**

Use a private `Map<string, number>` storing the first-recovery timestamp. On each claim, delete expired entries lazily. Do not store IP addresses, OAuth codes, HMACs, access tokens, or full callback URLs.

**Step 4: Verify the tests pass**

Run the same targeted test. Expected: all recovery registry tests pass.

**Step 5: Commit**

```bash
git add server/utils/oauth-recovery.ts server/utils/oauth-recovery.test.ts
git commit -m "test: add bounded OAuth recovery guard"
```

---

### Task 2: Extract safe callback-recovery helpers

**Objective:** Make cookie-expiry detection, shop sanitization, and recovery responses independently testable.

**Files:**
- Create: `server/utils/oauth-callback-recovery.ts`
- Test: `server/utils/oauth-callback-recovery.test.ts`
- Modify: `server/shopify-auth.ts:1-17` (imports only in this task)

**Step 1: Write failing tests**

Test pure helpers for:

1. `isOAuthCookieNotFound(error)` returns true for Shopify's exported `CookieNotFound` class.
2. It returns false for generic errors, invalid-HMAC errors, token exchange failures, and plain strings that merely contain similar wording.
3. `buildOAuthRestartPath(shop)` returns only a relative path such as `/api/auth?shop=store.myshopify.com`.
4. Invalid shop values, alternate domains, encoded control characters, and open-redirect payloads are rejected.
5. Recovery-page HTML escapes the shop value and contains no callback `code`, `hmac`, or `state` values.

Suggested API:

```ts
export function isOAuthCookieNotFound(error: unknown): boolean;
export function buildOAuthRestartPath(shop: string): string;
export function renderOAuthRecoveryPage(shop: string): string;
```

Use `CookieNotFound` from `@shopify/shopify-api` for typed detection. Use the existing `shopify.utils.sanitizeShop(..., true)` at the integration boundary; the pure path helper should receive an already sanitized domain and still enforce the `*.myshopify.com` shape defensively.

**Step 2: Verify the tests fail**

```bash
npx vitest run server/utils/oauth-callback-recovery.test.ts
```

Expected: FAIL because helpers do not exist.

**Step 3: Implement minimal helpers**

Recovery-page requirements:

- Human copy: “The Shopify approval took longer than the secure sign-in window. Reconnect Duplicate Guard to finish setup.”
- Primary link: the safe relative OAuth restart path.
- No stack trace or raw exception text.
- `Cache-Control: no-store` will be set by the route, not embedded in HTML.
- Avoid adding a new templating dependency.

**Step 4: Verify targeted tests pass**

Run the targeted test file. Expected: all tests pass.

**Step 5: Commit**

```bash
git add server/utils/oauth-callback-recovery.ts server/utils/oauth-callback-recovery.test.ts server/shopify-auth.ts
git commit -m "feat: add safe OAuth callback recovery helpers"
```

---

### Task 3: Recover once from an expired OAuth cookie

**Objective:** Replace the raw 500 for `CookieNotFound` with one automatic OAuth restart and a bounded manual fallback.

**Files:**
- Modify: `server/shopify-auth.ts:279-349,800-809`
- Create: `server/utils/oauth-callback-runner.ts`
- Create: `server/utils/oauth-callback-runner.test.ts`

**Step 1: Make the callback handler testable**

Extract the callback invocation and post-auth workflow behind a small injectable function or dependency object. Do not mock the entire 970-line module through fragile global state. The production default must still call:

```ts
shopify.auth.callback({
  rawRequest: req,
  rawResponse: res,
  expiring: true,
});
```

**Step 2: Write failing handler tests**

Using mocked Request/Response objects and a mocked callback dependency, verify:

1. First `CookieNotFound` for `slow-shop.myshopify.com` discards the stale callback and responds with `303` to `/api/auth?shop=slow-shop.myshopify.com`.
2. The first failure logs `oauth_cookie_missing`, `action=automatic_retry`, and the sanitized shop; it logs no code, HMAC, state, timestamp, host, or callback URL.
3. Second `CookieNotFound` inside the TTL responds with a non-500 recovery page (recommended `409`) and `Cache-Control: no-store`.
4. Repeated failure does not redirect again.
5. Invalid or missing `shop` on a cookie error returns `400` and never redirects.
6. Generic callback errors retain the existing server-error path and do not trigger OAuth recovery.
7. A successful callback clears the retry marker.
8. A successful callback continues into existing session storage, webhook registration, billing reconciliation, scan startup, and final app redirect behavior.

**Step 3: Verify the tests fail**

```bash
npx vitest run server/utils/oauth-callback-runner.test.ts
```

Expected: FAIL because cookie errors currently return a raw 500.

**Step 4: Implement minimal recovery behavior**

At the `authCallback` catch boundary, handle only typed `CookieNotFound`, sanitize `req.query.shop`, and discard every other stale callback parameter:

```ts
if (isOAuthCookieNotFound(error)) {
  const shop = sanitizeCallbackShop(req.query.shop);
  if (!shop) {
    return res.status(400).send("Invalid Shopify shop");
  }

  if (oauthRecoveryRegistry.claimAutomaticRetry(shop)) {
    logger.warn("[AuthCallback] oauth_cookie_missing", {
      shop,
      action: "automatic_retry",
    });
    res.set("Cache-Control", "no-store");
    return res.redirect(303, buildOAuthRestartPath(shop));
  }

  logger.error("[AuthCallback] oauth_cookie_missing", {
    shop,
    action: "manual_recovery",
  });
  res.set("Cache-Control", "no-store");
  return res.status(409).send(renderOAuthRecoveryPage(shop));
}
```

On successful fresh callback completion, call `oauthRecoveryRegistry.clear(session.shop)` before the final redirect. Do not clear the guard when `/api/auth` starts; clear it only after the SDK validates the fresh callback and returns a session.

Do not include `code`, `hmac`, `state`, cookies, tokens, or complete callback URLs in logs.

**Step 5: Verify targeted tests pass**

Run the targeted handler and helper tests. Expected: all pass.

**Step 6: Commit**

```bash
git add server/shopify-auth.ts server/utils/oauth-*.ts
git commit -m "fix: recover expired Shopify OAuth callbacks"
```

---

### Task 4: Add regression coverage for the complete recovery sequence

**Objective:** Prove the exact observed failure sequence does not strand a merchant.

**Files:**
- Modify: `server/utils/oauth-callback-runner.test.ts`

**Step 1: Add a sequence test**

Simulate:

1. Callback throws `CookieNotFound` after the original approval.
2. Handler returns one `303` restart.
3. A second callback succeeds with an offline session.
4. Retry state is cleared.
5. A future unrelated cookie expiry can claim one retry again.

Assert that the successful path receives `expiring: true` and stores the returned offline session before final redirect.

**Step 2: Add a loop-prevention sequence test**

Simulate two consecutive `CookieNotFound` callbacks inside 10 minutes and assert:

- exactly one redirect,
- second response is the recovery page,
- no third OAuth start is initiated automatically.

**Step 3: Run targeted suite**

```bash
npx vitest run \
  server/utils/oauth-recovery.test.ts \
  server/utils/oauth-callback-recovery.test.ts \
  server/utils/oauth-callback-runner.test.ts
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add server/utils/oauth-callback-runner.test.ts
git commit -m "test: cover slow Shopify install recovery"
```

---

### Task 5: Run repository-wide verification

**Objective:** Confirm the recovery change does not break existing app behavior.

**Files:** None unless failures require fixes.

**Step 1: Run all tests**

```bash
npm test
```

Expected: all Vitest tests pass.

**Step 2: Run TypeScript checks**

```bash
npm run check
```

Expected: exit 0 with no TypeScript errors.

**Step 3: Build the production bundle**

```bash
npm run build
```

Expected: Vite client and esbuild server bundles complete successfully.

**Step 4: Review the diff**

```bash
git diff --check
git diff --stat
git diff -- server/shopify-auth.ts server/utils
```

Review for:

- no OAuth secrets in logs or HTML,
- no manual HMAC/token implementation,
- one automatic retry maximum,
- valid-shop-only redirects,
- existing successful callback workflow unchanged,
- no edits to `node_modules`.

**Step 5: Commit any verification fixes**

```bash
git add <only-the-files-fixed>
git commit -m "fix: address OAuth recovery verification findings"
```

---

### Task 6: Review and deploy behind explicit approval

**Objective:** Ship safely and verify the production behavior with real evidence.

**Files:** No source changes expected.

**Step 1: Request code review**

Review must confirm:

- Shopify SDK remains responsible for OAuth validation and token exchange.
- Recovery activates only for `CookieNotFound`.
- Redirect target is a sanitized relative path.
- Retry registry cannot create an unbounded redirect loop.
- Existing callback success behavior is preserved.

**Step 2: Obtain Amer's deployment/restart approval**

Deployment and service/container replacement are production changes. Do not deploy, restart, or stop containers without explicit approval.

**Step 3: Deploy using the existing Duplicate Guard release path**

Do not improvise a second deployment mechanism. Record image/release identity and deployment timestamp.

**Step 4: Run production smoke checks**

Read-only checks:

```bash
curl -fsS https://orderauditor.amertech.online/api/health
```

Expected: `{"status":"ok", ...}`.

Check container state and logs without printing secrets. Confirm no restart loop and no new generic callback exceptions.

**Step 5: Verify with a controlled development/test store**

Use a store where install testing is authorized:

1. Begin a fresh install.
2. Deliberately wait more than 60 seconds before approval.
3. Approve the app.
4. Confirm one automatic OAuth restart occurs.
5. Confirm the second authorization completes without another approval delay.
6. Confirm DB rows exist for:
   - `shopify_sessions` with an offline access token,
   - `subscriptions`,
   - `detection_settings` when created by normal flow,
   - `historical_scan_runs` when auto-started.
7. Confirm expected webhooks register or any non-blocking registration limitations are clearly logged.

**Step 6: Verify the two affected merchants if they return**

For MuscleEase™ (`tqwi9s-nj.myshopify.com`) and Velion (`axi0m6-ir.myshopify.com`), do not claim recovery until one of these occurs:

- merchant reopens the installed app and OAuth completes, or
- merchant reinstalls and OAuth completes.

Then verify Partner relationship state plus the production DB offline session. Partner `INSTALLED` alone remains insufficient.

---

## Acceptance criteria

- A Shopify callback delayed beyond 60 seconds no longer ends at a raw HTTP 500.
- The app automatically restarts OAuth at most once per shop per 10-minute window.
- A repeated cookie failure shows a safe manual recovery page and cannot loop.
- Invalid shops and non-cookie OAuth failures cannot enter the recovery redirect.
- The expired callback is never treated as authorized; the fresh SDK callback validates HMAC and state and performs token exchange.
- Successful recovery creates the normal offline session and continues existing post-auth setup.
- Logs identify recovery outcomes without secrets or raw callback URLs.
- Targeted tests, full tests, TypeScript check, and production build pass.
- Production deployment and merchant-facing recovery are performed only after explicit approval.

## Rollback

- Revert the recovery commit(s) and redeploy the previously known-good image.
- No database rollback is needed because this design adds no schema or persistent recovery state.
- If recovery causes unexpected loops, disable/revert the automatic retry while retaining the safe non-500 recovery page.

## Follow-up after stabilization

Add a read-only install consistency monitor: alert when Shopify Partner reports `RELATIONSHIP_INSTALLED` but Duplicate Guard has no offline `shopify_sessions` row after five minutes. Keep merchant identifiers out of routine notifications unless needed for incident handling.
