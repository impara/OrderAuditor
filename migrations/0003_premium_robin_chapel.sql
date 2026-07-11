CREATE TABLE "historical_scan_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"status_updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"window_days" integer DEFAULT 60 NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"orders_fetched" integer DEFAULT 0 NOT NULL,
	"orders_imported" integer DEFAULT 0 NOT NULL,
	"matches_found" integer DEFAULT 0 NOT NULL,
	"candidate_cap_exceeded" boolean DEFAULT false NOT NULL,
	"queue_job_id" varchar,
	"error_message" text,
	CONSTRAINT "historical_scan_runs_shop_domain_unique" UNIQUE("shop_domain")
);
