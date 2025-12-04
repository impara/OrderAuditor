CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"order_id" varchar NOT NULL,
	"action" varchar(50) NOT NULL,
	"details" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detection_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"time_window_hours" integer DEFAULT 24 NOT NULL,
	"match_email" boolean DEFAULT true NOT NULL,
	"match_phone" boolean DEFAULT false NOT NULL,
	"match_address" boolean DEFAULT true NOT NULL,
	"enable_notifications" boolean DEFAULT false NOT NULL,
	"notification_email" text,
	"slack_webhook_url" text,
	"notification_threshold" integer DEFAULT 80 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "detection_settings_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"shopify_order_id" varchar NOT NULL,
	"order_number" varchar NOT NULL,
	"customer_email" text NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"shipping_address" jsonb,
	"total_price" numeric(10, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_at" timestamp NOT NULL,
	"is_flagged" boolean DEFAULT false NOT NULL,
	"flagged_at" timestamp,
	"duplicate_of_order_id" varchar,
	"match_reason" text,
	"match_confidence" integer,
	"resolved_at" timestamp,
	"resolved_by" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "shopify_sessions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"shop" varchar NOT NULL,
	"state" varchar,
	"is_online" boolean DEFAULT false NOT NULL,
	"scope" text,
	"expires" timestamp,
	"access_token" text,
	"user_id" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"email" varchar,
	"account_owner" boolean DEFAULT false,
	"locale" varchar,
	"collaborator" boolean DEFAULT false,
	"email_verified" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_shop_domain" varchar(255) NOT NULL,
	"tier" varchar(20) DEFAULT 'free' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"monthly_order_count" integer DEFAULT 0 NOT NULL,
	"order_limit" integer DEFAULT 50 NOT NULL,
	"current_billing_period_start" timestamp DEFAULT now() NOT NULL,
	"current_billing_period_end" timestamp,
	"shopify_charge_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_shopify_shop_domain_unique" UNIQUE("shopify_shop_domain")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"topic" varchar(100) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_shop_delivery_idx" ON "webhook_deliveries" USING btree ("shop_domain","delivery_id");