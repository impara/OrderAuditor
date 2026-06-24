ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_phone_normalized" text;--> statement-breakpoint
WITH phone_source AS (
  SELECT
    "id",
    trim("customer_phone") AS raw_phone,
    regexp_replace(trim("customer_phone"), '\D', '', 'g') AS digits
  FROM "orders"
  WHERE "customer_phone" IS NOT NULL
    AND "customer_phone_normalized" IS NULL
),
normalized_phone AS (
  SELECT
    "id",
    CASE
      WHEN raw_phone LIKE '+%' THEN '+' || regexp_replace(substring(raw_phone from 2), '\D', '', 'g')
      WHEN length(digits) = 10 THEN '+1' || digits
      WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
      ELSE digits
    END AS normalized
  FROM phone_source
)
UPDATE "orders"
SET "customer_phone_normalized" = NULLIF(normalized_phone.normalized, '')
FROM normalized_phone
WHERE "orders"."id" = normalized_phone."id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_shop_phone_norm_created_at_idx" ON "orders" USING btree ("shop_domain","customer_phone_normalized","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_shop_flagged_at_idx" ON "orders" USING btree ("shop_domain","is_flagged","flagged_at");
