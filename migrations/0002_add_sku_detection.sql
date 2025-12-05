ALTER TABLE "detection_settings" ADD COLUMN "match_sku" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "line_items" jsonb;