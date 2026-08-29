# Product activation telemetry

Duplicate Guard stores a small allowlisted set of first-party events to answer the activation question: after a successful recent-order scan, do merchants see the result and open a match for review?

## Events

- `dashboard_opened`: once per browser session.
- `scan_summary_viewed`: once per completed scan per browser session, with only `no_orders`, `no_matches`, or `matches_found`.
- `match_review_opened`: the first match review reached in a browser session. No order identifier is stored.
- `quota_banner_seen`: once per state and percentage bucket per browser session.
- Existing audit-log `dismissed` is the observable manual dashboard decision endpoint. `resolved` may result from non-manual behavior such as Shopify tag removal and must not be counted as a completed merchant review without additional evidence.

## Privacy and tenancy

The endpoint is behind verified Shopify API middleware. Payload-provided shop fields are ignored; the server derives tenant identity exclusively from the verified Shopify session in `res.locals.shopify`. Event property schemas reject extra fields, including customer, order, and merchant identifiers. Event keys are random opaque nonces used only for idempotency. No external analytics service receives these events.

`shop_domain` remains first-party merchant data. It is required for tenant isolation, distinct-shop aggregates, and uninstall erasure. Shop uninstall cleanup deletes all product events for that shop.

## Metric semantics

These events provide directional shop-level and aggregate evidence, not a person-level or exact order-level funnel. New browser sessions can create new events.

Use:

- event counts by type and time window;
- distinct shops by event type;
- distinct shops with both `scan_summary_viewed` and `match_review_opened` in a window;
- scan-status and quota-bucket counts.

Generate an aggregate evidence packet with:

```bash
npm run evidence:activation -- --days=30 > product-activation-evidence.json
```

The report contains event totals, distinct-shop totals, and time bounds only. Review it before adding it as an evidence location in the portfolio access inventory.

Do not claim exact user conversion, exact per-order review rates, or causation from these events alone.

## Retention

Before production deployment, set a raw-event retention window. Recommended default: 90 days, followed by deletion of raw rows while retaining only non-identifying aggregate reports. The current migration creates storage but does not schedule retention or apply any production change.

## Deployment gate

Production rollout requires, in order:

1. approve and apply the committed database migration;
2. deploy the matching server and client release;
3. verify authenticated event insertion on a test shop;
4. add and verify the retention purge before the 90-day window expires.
