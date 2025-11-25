import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Orders table - stores order data from Shopify webhooks
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(), // Multi-tenancy support
  shopifyOrderId: varchar("shopify_order_id").notNull(), // Removed unique constraint as different shops might have same ID (unlikely but possible with different shops) or same order ID across shops? No, shopify IDs are unique globally usually, but safer to scope by shop. Actually, let's keep it unique per shop if possible, but for now just remove unique or make it unique(shop, orderId).
  // To avoid complex composite keys in Drizzle for now, let's just remove unique constraint on shopifyOrderId or make it unique per shop.
  // Actually, Shopify IDs are unique across all of Shopify. But let's be safe.
  orderNumber: varchar("order_number").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
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
  flaggedAt: timestamp("flagged_at"),
  duplicateOfOrderId: varchar("duplicate_of_order_id"),
  matchReason: text("match_reason"),
  matchConfidence: integer("match_confidence"), // 0-100 percentage
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 50 }), // 'manual_dashboard', 'shopify_tag_removed', 'auto_merged'
});

// Detection settings table - stores configuration for duplicate detection
export const detectionSettings = pgTable("detection_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull().unique(), // One settings row per shop
  timeWindowHours: integer("time_window_hours").notNull().default(24),
  matchEmail: boolean("match_email").notNull().default(true),
  matchPhone: boolean("match_phone").notNull().default(false),
  matchAddress: boolean("match_address").notNull().default(true),
  addressSensitivity: varchar("address_sensitivity", { length: 20 }).notNull().default("medium"), // low, medium, high
  enableNotifications: boolean("enable_notifications").notNull().default(false),
  notificationEmail: text("notification_email"),
  slackWebhookUrl: text("slack_webhook_url"),
  notificationThreshold: integer("notification_threshold").notNull().default(80), // Only notify if confidence >= this
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Audit logs table - tracks all duplicate detection events
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: varchar("shop_domain").notNull(),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  action: varchar("action", { length: 50 }).notNull(), // 'flagged', 'tagged', 'reviewed', 'dismissed', 'resolved'
  details: jsonb("details").$type<Record<string, any>>(),
  performedAt: timestamp("performed_at").notNull().default(sql`now()`),
});

// Shopify Sessions table - stores OAuth sessions
export const shopifySessions = pgTable("shopify_sessions", {
  id: varchar("id").primaryKey(), // Session ID from Shopify
  shop: varchar("shop").notNull(),
  state: varchar("state"), // Nullable - state is only used during OAuth flow, not after
  isOnline: boolean("is_online").notNull().default(false),
  scope: text("scope"),
  expires: timestamp("expires"),
  accessToken: varchar("access_token"),
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
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shopifyShopDomain: varchar("shopify_shop_domain", { length: 255 }).notNull().unique(),
  tier: varchar("tier", { length: 20 }).notNull().default("free"), // 'free', 'paid'
  status: varchar("status", { length: 20 }).notNull().default("active"), // 'active', 'cancelled', 'expired'
  monthlyOrderCount: integer("monthly_order_count").notNull().default(0),
  orderLimit: integer("order_limit").notNull().default(50), // 50 for free, -1 for unlimited paid
  currentBillingPeriodStart: timestamp("current_billing_period_start").notNull().default(sql`now()`),
  currentBillingPeriodEnd: timestamp("current_billing_period_end"),
  shopifyChargeId: varchar("shopify_charge_id", { length: 255 }), // Shopify Billing API charge ID
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Insert schemas for validation
export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  isFlagged: true,
  flaggedAt: true,
  duplicateOfOrderId: true,
  matchReason: true,
  matchConfidence: true,
});

export const insertDetectionSettingsSchema = createInsertSchema(detectionSettings).omit({
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
});

// Update schema for settings
export const updateDetectionSettingsSchema = insertDetectionSettingsSchema.partial();

export const updateSubscriptionSchema = insertSubscriptionSchema.partial();

// Types
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type DetectionSettings = typeof detectionSettings.$inferSelect;
export type InsertDetectionSettings = z.infer<typeof insertDetectionSettingsSchema>;
export type UpdateDetectionSettings = z.infer<typeof updateDetectionSettingsSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;
export type ShopifySession = typeof shopifySessions.$inferSelect;

// Dashboard stats type
export type DashboardStats = {
  totalFlagged: number;
  totalFlaggedTrend: number; // percentage change from last 7 days
  potentialDuplicateValue: number;
  ordersFlaggedToday: number;
  averageResolutionTime: number; // in hours
};
