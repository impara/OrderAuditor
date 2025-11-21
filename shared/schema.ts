import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Orders table - stores order data from Shopify webhooks
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  shopifyOrderId: varchar("shopify_order_id").notNull().unique(),
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
});

// Detection settings table - stores configuration for duplicate detection
// NOTE: Single row enforced by application logic
export const detectionSettings = pgTable("detection_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  orderId: varchar("order_id").notNull().references(() => orders.id),
  action: varchar("action", { length: 50 }).notNull(), // 'flagged', 'tagged', 'reviewed', 'dismissed'
  details: jsonb("details").$type<Record<string, any>>(),
  performedAt: timestamp("performed_at").notNull().default(sql`now()`),
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

// Update schema for settings
export const updateDetectionSettingsSchema = insertDetectionSettingsSchema.partial();

// Types
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type DetectionSettings = typeof detectionSettings.$inferSelect;
export type InsertDetectionSettings = z.infer<typeof insertDetectionSettingsSchema>;
export type UpdateDetectionSettings = z.infer<typeof updateDetectionSettingsSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Dashboard stats type
export type DashboardStats = {
  totalFlagged: number;
  totalFlaggedTrend: number; // percentage change from last 7 days
  potentialDuplicateValue: number;
  ordersFlaggedToday: number;
  averageResolutionTime: number; // in hours
};
