CREATE TABLE "product_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"event_name" varchar(50) NOT NULL,
	"event_key" varchar(128) NOT NULL,
	"properties" jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_events_shop_event_occurred_idx" ON "product_events" USING btree ("shop_domain","event_name","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_shop_event_key_idx" ON "product_events" USING btree ("shop_domain","event_name","event_key");