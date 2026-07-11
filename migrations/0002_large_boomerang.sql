ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "flag_source" varchar(20) DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "flagged_by_scan_run_id" varchar;
