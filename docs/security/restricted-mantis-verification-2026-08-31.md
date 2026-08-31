# Restricted Mantis remediation verification cases

Date: 2026-08-31
Branch: `wt/t_9a58b783`

These checks use synthetic data only and must not be run against production endpoints.

## DG-SEC-01 — internal cleanup authorization

- Pre-fix condition: `/api/internal/*` bypassed Shopify auth and `/api/internal/cleanup` had no route guard.
- Automated check: `server/utils/security.test.ts` verifies the internal guard accepts only the configured `X-Admin-Token`, ignores `?token=`, and fails closed in production without configuration.
- Source check: `server/routes.ts` must register `app.use("/api/internal", requireInternalAdmin)` before internal route declarations.
- Pass: query-only token receives 401; missing production configuration receives 503; correct header reaches `next()`.

## DG-SEC-02 — Slack SSRF

- Pre-fix condition: arbitrary merchant-controlled text was passed to server-side `fetch()`.
- Automated check: URL-table tests accept only canonical HTTPS `hooks.slack.com/services/...` URLs and reject HTTP, private hosts, user-info tricks, alternate ports, deceptive suffixes, and query strings.
- Source check: settings validation and notification dispatch both call `isAllowedSlackWebhookUrl`; fetch uses `redirect: "error"`.
- Pass: every unsafe destination is rejected before network access.

## DG-SEC-03 — session-token disclosure

- Pre-fix condition: the complete rejected bearer token was interpolated into an error, logged, and returned.
- Automated check: `sessionTokenVerificationError()` returns one stable token-free message.
- Source check: `verifyRequest` returns only `{ message: "Unauthorized" }`; no source match exists for token interpolation in parser errors.
- Pass: sentinel bearer material appears in neither logs nor response construction.

## DG-SEC-04 — billing/open redirect

- Pre-fix condition: `//evil.example/path` passed the starts-with-slash check.
- Automated check: relative and exact-origin URLs pass; protocol-relative, off-origin, alternate-port, and `javascript:` inputs return the configured safe fallback.
- Source check: `/exitiframe` compares the resolved URL with `validateReturnUrl()` output before rendering.
- Pass: only exact-origin HTTP(S) destinations survive.

## DG-SEC-05 — sensitive logging

- Pre-fix condition: API response prefixes, webhook-body prefixes, customer emails, raw phone values, and token prefixes were logged.
- Source check: search for the prior logging strings returns zero matches; request logging includes only method, path, status, and duration.
- Pass: no raw email, phone, body, response object, access token, or token prefix is emitted by the reviewed paths.

## DG-SEC-06 — iframe protection

- Automated check: valid shop domains produce `frame-ancestors https://{shop}.myshopify.com https://admin.shopify.com;`; malicious shop strings are not reflected.
- Source check: `server/app.ts` sets the CSP header before routes.
- Pass: every response carries a non-injectable `frame-ancestors` directive; HTML with a valid shop includes both allowed ancestors.

## DG-SEC-07 — queue-token persistence

- Source check: `OrderCreateJobData` and the `orders/create` enqueue payload contain no `accessToken`; the worker resolves a fresh token at processing time.
- Pass: repository search finds no queue-payload access-token field.

## DG-SEC-08 — dependencies

- Commands: `npm audit --omit=dev`, `npm run check`, `npm test`, `npm run build`.
- Pass: no moderate/high/critical production advisory; checks, tests, and build pass.
- Accepted residual: one low production-graph esbuild advisory and five development-tool advisories tied to a future Vite 8 migration. They do not justify `npm audit fix --force` in this security patch.

## DG-SEC-09 — query-string admin token

- Automated check: a correct `?token=` with no header receives 401.
- Source check: `requireInternalAdmin` reads only `X-Admin-Token`.
- Pass: no `req.query.token` use remains.

## Full regression gate

- `npm run check`
- `npm test`
- `npm run build`
- `git diff --check`
- Search changed files for secret literals and the removed sensitive logging patterns.
