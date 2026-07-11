import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Orders table - stores order data from Shopify webhooks
export const orders = pgTable(
  "orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    shopDomain: varchar("shop_domain").notNull(), // Multi-tenancy support
    shopifyOrderId: varchar("shopify_order_id").notNull(),
    orderNumber: varchar("order_number").notNull(),
    customerEmail: text("customer_email"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerPhoneNormalized: text("customer_phone_normalized"),
    shippingAddress: jsonb("shipping_address").$type<{
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      country?: string;
      zip?: string;
    }>(),
    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    isFlagged: boolean("is_flagged").default(false).notNull(),
    flagSource: varchar("flag_source", { length: 20 }).notNull().default("live"),
    flaggedByScanRunId: varchar("flagged_by_scan_run_id"),
    flaggedAt: timestamp("flagged_at"),
    duplicateOfOrderId: varchar("duplicate_of_order_id"),
    matchReason: text("match_reason"),
    matchConfidence: integer("match_confidence"), // 0-100 percentage
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: varchar("resolved_by", { length: 50 }), // 'manual_dashboard', 'shopify_tag_removed', 'auto_merged'
    lineItems: jsonb("line_items").$type<
      Array<{
        id: string;
        sku: string | null;
        title: string;
        quantity: number;
        price: string;
      }>
    >(),
  },
  (table) => ({
    shopOrderUnique: uniqueIndex("orders_shop_order_idx").on(
      table.shopDomain,
      table.shopifyOrderId
    ),
    shopEmailCreatedAtIdx: index("orders_shop_email_created_at_idx").on(
      table.shopDomain,
      table.customerEmail,
      table.createdAt
    ),
    shopCreatedAtIdx: index("orders_shop_created_at_idx").on(
      table.shopDomain,
      table.createdAt
    ),
    shopPhoneNormalizedCreatedAtIdx: index(
      "orders_shop_phone_norm_created_at_idx"
    ).on(table.shopDomain, table.customerPhoneNormalized, table.createdAt),
    shopFlaggedAtIdx: index("orders_shop_flagged_at_idx").on(
      table.shopDomain,
      table.isFlagged,
      table.flaggedAt
    ),
  })
);

// Detection settings table - stores configuration for duplicate detection
export const detectionSettings = pgTable("detection_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(), // One settings row per shop
  timeWindowHours: integer("time_window_hours").notNull().default(24),
  matchEmail: boolean("match_email").notNull().default(true),
  matchPhone: boolean("match_phone").notNull().default(false),
  matchAddress: boolean("match_address").notNull().default(true),
  matchSku: boolean("match_sku").notNull().default(false), // New setting for SKU matching
  enableNotifications: boolean("enable_notifications").notNull().default(false),
  notificationEmail: text("notification_email"),
  slackWebhookUrl: text("slack_webhook_url"),
  notificationThreshold: integer("notification_threshold")
    .notNull()
    .default(80), // Only notify if confidence >= this
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
});

// Audit logs table - tracks all duplicate detection events
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  orderId: varchar("order_id")
    .notNull()
    .references(() => orders.id),
  action: varchar("action", { length: 50 }).notNull(), // 'flagged', 'tagged', 'reviewed', 'dismissed', 'resolved'
  details: jsonb("details").$type<Record<string, any>>(),
  performedAt: timestamp("performed_at")
    .notNull()
    .default(sql`now()`),
});

// Shopify Sessions table - stores OAuth sessions
export const shopifySessions = pgTable("shopify_sessions", {
  id: varchar("id").primaryKey(), // Session ID from Shopify
  shop: varchar("shop").notNull(),
  state: varchar("state"), // Nullable - state is only used during OAuth flow, not after
  isOnline: boolean("is_online").notNull().default(false),
  scope: text("scope"),
  expires: timestamp("expires"),
  accessToken: text("access_token"), // Changed from varchar to text to support full-length tokens (Shopify tokens can be 40+ chars)
  refreshToken: text("refresh_token"), // Expiring offline tokens: rotating refresh token used to obtain new access tokens
  refreshTokenExpires: timestamp("refresh_token_expires"), // When the refresh token expires (~90 days, rotates on each refresh)
  userId: varchar("user_id"), // Shopify user ID (can be big int, storing as string for safety)
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  email: varchar("email"),
  accountOwner: boolean("account_owner").default(false),
  locale: varchar("locale"),
  collaborator: boolean("collaborator").default(false),
  emailVerified: boolean("email_verified").default(false),
});

// Subscriptions table - tracks subscription tier and usage
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  shopifyShopDomain: varchar("shopify_shop_domain", { length: 255 })
    .notNull()
    .unique(),
  tier: varchar("tier", { length: 20 }).notNull().default("free"), // 'free', 'paid'
  status: varchar("status", { length: 20 }).notNull().default("active"), // 'active', 'cancelled', 'expired'
  monthlyOrderCount: integer("monthly_order_count").notNull().default(0),
  allTimeOrderCount: integer("all_time_order_count").notNull().default(0),
  orderLimit: integer("order_limit").notNull().default(30), // 30 for free, -1 for unlimited paid
  currentBillingPeriodStart: timestamp("current_billing_period_start")
    .notNull()
    .default(sql`now()`),
  currentBillingPeriodEnd: timestamp("current_billing_period_end"),
  shopifyChargeId: varchar("shopify_charge_id", { length: 255 }), // Shopify Billing API charge ID
  quotaExceededNotifiedAt: timestamp("quota_exceeded_notified_at"), // Timestamp when 100% quota notification was sent
  reviewPromptDismissedAt: timestamp("review_prompt_dismissed_at"),
  reviewPromptDeferredUntil: timestamp("review_prompt_deferred_until"),
  reviewPromptResponse: varchar("review_prompt_response", { length: 20 }).$type<
    "positive" | "negative" | "dismissed"
  >(),
  reviewPromptRespondedAt: timestamp("review_prompt_responded_at"),
  reviewPromptCtaClickedAt: timestamp("review_prompt_cta_clicked_at"),
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`now()`),
});

// Webhook deliveries table - tracks webhook delivery IDs to prevent duplicate processing
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    shopDomain: varchar("shop_domain").notNull(),
    deliveryId: varchar("delivery_id", { length: 255 }).notNull(), // X-Shopify-Delivery-Id or X-Shopify-Webhook-Id header
    topic: varchar("topic", { length: 100 }).notNull(), // e.g., 'orders/create', 'orders/updated', 'app/uninstalled'
    status: varchar("status", { length: 20 })
      .$type<"queued" | "processing" | "processed" | "failed">()
      .notNull()
      .default("processed"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at")
      .notNull()
      .default(sql`now()`),
    failedAt: timestamp("failed_at"),
    processedAt: timestamp("processed_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Unique constraint to prevent duplicate processing of the same webhook delivery
    shopDeliveryUnique: uniqueIndex("webhook_deliveries_shop_delivery_idx").on(
      table.shopDomain,
      table.deliveryId
    ),
  })
);

export const historicalScanRuns = pgTable("historical_scan_runs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(),
  status: varchar("status", { length: 20 })
    .$type<"queued" | "running" | "completed" | "failed">()
    .notNull()
    .default("queued"),
  requestedAt: timestamp("requested_at").notNull().default(sql`now()`),
  statusUpdatedAt: timestamp("status_updated_at").notNull().default(sql`now()`),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  windowDays: integer("window_days").notNull().default(60),
  attemptCount: integer("attempt_count").notNull().default(1),
  ordersFetched: integer("orders_fetched").notNull().default(0),
  ordersImported: integer("orders_imported").notNull().default(0),
  matchesFound: integer("matches_found").notNull().default(0),
  candidateCapExceeded: boolean("candidate_cap_exceeded")
    .notNull()
    .default(false),
  queueJobId: varchar("queue_job_id"),
  errorMessage: text("error_message"),
});

// Insert schemas for validation
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  resolvedAt: true,
  resolvedBy: true,
  customerPhoneNormalized: true,
});

export const insertDetectionSettingsSchema = createInsertSchema(
  detectionSettings
).omit({
  id: true,
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  performedAt: true,
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  reviewPromptResponse: z
    .enum(["positive", "negative", "dismissed"])
    .nullable()
    .optional(),
});

export const insertWebhookDeliverySchema = createInsertSchema(
  webhookDeliveries
).omit({
  id: true,
  status: true,
  attemptCount: true,
  lastError: true,
  receivedAt: true,
  failedAt: true,
  processedAt: true,
});

export const insertHistoricalScanRunSchema = createInsertSchema(
  historicalScanRuns
).omit({
  id: true,
  statusUpdatedAt: true,
  startedAt: true,
  completedAt: true,
});

// Update schema for settings
export const updateDetectionSettingsSchema =
  insertDetectionSettingsSchema.partial();

export const updateSubscriptionSchema = insertSubscriptionSchema.partial();

// Types
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type DetectionSettings = typeof detectionSettings.$inferSelect;
export type InsertDetectionSettings = z.infer<
  typeof insertDetectionSettingsSchema
>;
export type UpdateDetectionSettings = z.infer<
  typeof updateDetectionSettingsSchema
>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type HistoricalScanRun = typeof historicalScanRuns.$inferSelect;
export type InsertHistoricalScanRun = typeof historicalScanRuns.$inferInsert;
export type ShopifySession = typeof shopifySessions.$inferSelect;

// Dashboard stats type
export type DashboardStats = {
  totalFlagged: number;
  totalFlaggedTrend: number; // percentage change from last 7 days
  potentialDuplicateValue: number;
  ordersFlaggedToday: number;
  averageResolutionTime: number; // in hours
};
