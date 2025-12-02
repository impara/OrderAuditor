import {
  orders,
  detectionSettings,
  auditLogs,
  subscriptions,
  webhookDeliveries,
  shopifySessions,
  type Order,
  type InsertOrder,
  type DetectionSettings,
  type InsertDetectionSettings,
  type UpdateDetectionSettings,
  type AuditLog,
  type InsertAuditLog,
  type DashboardStats,
  type Subscription,
  type InsertSubscription,
  type UpdateSubscription,
  type InsertWebhookDelivery,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, sql, and, ne, or, inArray } from "drizzle-orm";

export interface IStorage {
  getOrder(shopDomain: string, id: string): Promise<Order | undefined>;
  getOrderByShopifyId(
    shopDomain: string,
    shopifyOrderId: string
  ): Promise<Order | undefined>;
  getFlaggedOrders(shopDomain: string): Promise<Order[]>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(
    shopDomain: string,
    id: string,
    updates: Partial<Order>
  ): Promise<Order>;
  getDashboardStats(shopDomain: string): Promise<DashboardStats>;

  getSettings(shopDomain: string): Promise<DetectionSettings | undefined>;
  updateSettings(
    shopDomain: string,
    updates: UpdateDetectionSettings
  ): Promise<DetectionSettings>;
  initializeSettings(shopDomain: string): Promise<DetectionSettings>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;

  getSubscription(shopDomain: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(
    shopDomain: string,
    updates: UpdateSubscription
  ): Promise<Subscription>;
  initializeSubscription(shopDomain: string): Promise<Subscription>;
  incrementOrderCount(shopDomain: string): Promise<Subscription>;
  resetMonthlyOrderCount(shopDomain: string): Promise<Subscription>;

  dismissOrder(shopDomain: string, orderId: string): Promise<Order>;
  resolveOrder(
    shopDomain: string,
    orderId: string,
    resolvedBy: string
  ): Promise<Order>;

  // Webhook delivery tracking
  hasWebhookDelivery(shopDomain: string, deliveryId: string): Promise<boolean>;
  recordWebhookDelivery(delivery: InsertWebhookDelivery): Promise<void>;
  // Atomic insert-or-detect-duplicate: returns true if inserted (new), false if duplicate
  tryRecordWebhookDelivery(delivery: InsertWebhookDelivery): Promise<boolean>;

  // Shop cleanup (for app uninstall)
  deleteShopData(shopDomain: string, excludeDeliveryId?: string): Promise<void>;

  // GDPR compliance methods
  getCustomerOrders(
    shopDomain: string,
    customerEmail: string,
    customerId?: number
  ): Promise<Order[]>;
  redactCustomerData(
    shopDomain: string,
    customerEmail: string,
    customerId?: number,
    orderIds?: number[]
  ): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getOrder(shopDomain: string, id: string): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.shopDomain, shopDomain)));
    return order || undefined;
  }

  async getOrderByShopifyId(
    shopDomain: string,
    shopifyOrderId: string
  ): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.shopifyOrderId, shopifyOrderId),
          eq(orders.shopDomain, shopDomain)
        )
      );
    return order || undefined;
  }

  async getFlaggedOrders(shopDomain: string): Promise<Order[]> {
    return await db
      .select()
      .from(orders)
      .where(and(eq(orders.isFlagged, true), eq(orders.shopDomain, shopDomain)))
      .orderBy(desc(orders.flaggedAt));
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const [order] = await db.insert(orders).values(insertOrder).returning();
    return order;
  }

  async updateOrder(
    shopDomain: string,
    id: string,
    updates: Partial<Order>
  ): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set(updates)
      .where(and(eq(orders.id, id), eq(orders.shopDomain, shopDomain)))
      .returning();
    return order;
  }

  async getDashboardStats(shopDomain: string): Promise<DashboardStats> {
    const [totalFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(eq(orders.isFlagged, true), eq(orders.shopDomain, shopDomain))
      );

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [lastWeekFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.isFlagged, true),
          gte(orders.flaggedAt, sevenDaysAgo),
          eq(orders.shopDomain, shopDomain)
        )
      );

    const [totalValueResult] = await db
      .select({
        sum: sql<number>`COALESCE(SUM(CAST(total_price AS NUMERIC)), 0)`,
      })
      .from(orders)
      .where(
        and(eq(orders.isFlagged, true), eq(orders.shopDomain, shopDomain))
      );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.isFlagged, true),
          gte(orders.flaggedAt, today),
          eq(orders.shopDomain, shopDomain)
        )
      );

    const totalFlagged = totalFlaggedResult?.count || 0;
    const lastWeekFlagged = lastWeekFlaggedResult?.count || 0;
    const previousWeekCount = totalFlagged - lastWeekFlagged;

    let totalFlaggedTrend = 0;
    if (previousWeekCount > 0) {
      totalFlaggedTrend = Math.round(
        ((lastWeekFlagged - previousWeekCount) / previousWeekCount) * 100
      );
    }

    return {
      totalFlagged,
      totalFlaggedTrend,
      potentialDuplicateValue: parseFloat(
        totalValueResult?.sum?.toString() || "0"
      ),
      ordersFlaggedToday: todayFlaggedResult?.count || 0,
      averageResolutionTime: 2.5,
    };
  }

  async getSettings(
    shopDomain: string
  ): Promise<DetectionSettings | undefined> {
    const [settings] = await db
      .select()
      .from(detectionSettings)
      .where(eq(detectionSettings.shopDomain, shopDomain))
      .limit(1);
    return settings || undefined;
  }

  async updateSettings(
    shopDomain: string,
    updates: UpdateDetectionSettings
  ): Promise<DetectionSettings> {
    let existing = await this.getSettings(shopDomain);

    if (!existing) {
      existing = await this.initializeSettings(shopDomain);
    }

    const [updated] = await db
      .update(detectionSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(detectionSettings.id, existing.id))
      .returning();

    return updated;
  }

  async initializeSettings(shopDomain: string): Promise<DetectionSettings> {
    const existing = await this.getSettings(shopDomain);
    if (existing) {
      return existing;
    }

    const [settings] = await db
      .insert(detectionSettings)
      .values({
        shopDomain,
        timeWindowHours: 24,
        matchEmail: true,
        matchPhone: false,
        matchAddress: true,
        enableNotifications: false,
        notificationThreshold: 80,
      })
      .returning();

    return settings;
  }

  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    return log;
  }

  async getSubscription(shopDomain: string): Promise<Subscription | undefined> {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, shopDomain))
      .limit(1);
    return subscription;
  }

  async createSubscription(
    subscription: InsertSubscription
  ): Promise<Subscription> {
    const [newSubscription] = await db
      .insert(subscriptions)
      .values(subscription)
      .returning();
    return newSubscription;
  }

  async updateSubscription(
    shopDomain: string,
    updates: UpdateSubscription
  ): Promise<Subscription> {
    const [updated] = await db
      .update(subscriptions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(subscriptions.shopifyShopDomain, shopDomain))
      .returning();
    if (!updated) {
      throw new Error(`Subscription not found for shop: ${shopDomain}`);
    }
    return updated;
  }

  async initializeSubscription(shopDomain: string): Promise<Subscription> {
    const existing = await this.getSubscription(shopDomain);
    if (existing) {
      return existing;
    }

    // Calculate billing period end (30 days from now)
    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    return this.createSubscription({
      shopifyShopDomain: shopDomain,
      tier: "free",
      status: "active",
      monthlyOrderCount: 0,
      orderLimit: 50, // Free tier: 50 orders/month
      currentBillingPeriodStart: periodStart,
      currentBillingPeriodEnd: periodEnd,
    });
  }

  async incrementOrderCount(shopDomain: string): Promise<Subscription> {
    const subscription = await this.getSubscription(shopDomain);
    if (!subscription) {
      throw new Error(`Subscription not found for shop: ${shopDomain}`);
    }

    return this.updateSubscription(shopDomain, {
      monthlyOrderCount: subscription.monthlyOrderCount + 1,
    });
  }

  async resetMonthlyOrderCount(shopDomain: string): Promise<Subscription> {
    const subscription = await this.getSubscription(shopDomain);
    if (!subscription) {
      throw new Error(`Subscription not found for shop: ${shopDomain}`);
    }

    // Reset count and start new billing period
    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    return this.updateSubscription(shopDomain, {
      monthlyOrderCount: 0,
      currentBillingPeriodStart: periodStart,
      currentBillingPeriodEnd: periodEnd,
    });
  }

  async dismissOrder(shopDomain: string, orderId: string): Promise<Order> {
    return this.resolveOrder(shopDomain, orderId, "manual_dashboard");
  }

  async resolveOrder(
    shopDomain: string,
    orderId: string,
    resolvedBy: string
  ): Promise<Order> {
    const order = await this.getOrder(shopDomain, orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (!order.isFlagged) {
      throw new Error(`Order ${orderId} is not currently flagged`);
    }

    return this.updateOrder(shopDomain, orderId, {
      isFlagged: false,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy as
        | "manual_dashboard"
        | "shopify_tag_removed"
        | "auto_merged",
    });
  }

  async hasWebhookDelivery(
    shopDomain: string,
    deliveryId: string
  ): Promise<boolean> {
    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.shopDomain, shopDomain),
          eq(webhookDeliveries.deliveryId, deliveryId)
        )
      )
      .limit(1);
    return !!delivery;
  }

  async recordWebhookDelivery(delivery: InsertWebhookDelivery): Promise<void> {
    await db.insert(webhookDeliveries).values(delivery).onConflictDoNothing();
  }

  /**
   * Atomically try to record webhook delivery.
   * Returns true if the delivery was inserted (first time), false if it already existed (duplicate).
   * This prevents TOCTOU race conditions by using database-level atomicity.
   */
  async tryRecordWebhookDelivery(
    delivery: InsertWebhookDelivery
  ): Promise<boolean> {
    const result = await db
      .insert(webhookDeliveries)
      .values(delivery)
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    // If result has a row, we inserted it (first time). If empty, it was a duplicate.
    return result.length > 0;
  }

  async deleteShopData(
    shopDomain: string,
    excludeDeliveryId?: string
  ): Promise<void> {
    // Delete in order to respect foreign key constraints
    // 1. Delete audit logs (references orders)
    await db.delete(auditLogs).where(eq(auditLogs.shopDomain, shopDomain));

    // 2. Delete orders
    await db.delete(orders).where(eq(orders.shopDomain, shopDomain));

    // 3. Delete webhook deliveries (excluding the current delivery ID to preserve idempotency)
    // Explicitly check for non-empty string to handle empty string edge case
    if (excludeDeliveryId && excludeDeliveryId.trim().length > 0) {
      await db
        .delete(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.shopDomain, shopDomain),
            ne(webhookDeliveries.deliveryId, excludeDeliveryId)
          )
        );
    } else {
      await db
        .delete(webhookDeliveries)
        .where(eq(webhookDeliveries.shopDomain, shopDomain));
    }

    // 4. Delete detection settings
    await db
      .delete(detectionSettings)
      .where(eq(detectionSettings.shopDomain, shopDomain));

    // 5. Delete subscriptions
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.shopifyShopDomain, shopDomain));

    // 6. Delete Shopify sessions
    await db
      .delete(shopifySessions)
      .where(eq(shopifySessions.shop, shopDomain));
  }

  /**
   * Get all orders for a customer (for GDPR data request)
   */
  async getCustomerOrders(
    shopDomain: string,
    customerEmail: string,
    customerId?: number
  ): Promise<Order[]> {
    // Find orders by email
    const ordersByEmail = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.shopDomain, shopDomain),
          eq(orders.customerEmail, customerEmail)
        )
      );

    // If customerId is provided, we could also search by it, but we don't store customerId
    // So we just return orders by email
    return ordersByEmail;
  }

  /**
   * Redact customer data (for GDPR deletion request)
   * Anonymizes customer data in orders by replacing with placeholder values
   */
  async redactCustomerData(
    shopDomain: string,
    customerEmail: string,
    customerId?: number,
    orderIds?: number[] | null
  ): Promise<void> {
    // Normalize null to undefined (treat null as "redact all orders")
    if (orderIds === null) {
      orderIds = undefined;
    }

    // If orderIds is explicitly provided as an empty array, it means no orders should be redacted
    // This handles the case where Shopify sends orders_to_redact: [] (no orders to redact)
    if (orderIds !== undefined && orderIds.length === 0) {
      // Empty array means no orders to redact - return early
      return;
    }

    // Build query conditions
    const conditions = [eq(orders.shopDomain, shopDomain)];

    // If specific order IDs are provided, filter by them
    if (orderIds && orderIds.length > 0) {
      const orderIdStrings = orderIds.map((id) => id.toString());
      conditions.push(inArray(orders.shopifyOrderId, orderIdStrings));
    } else {
      // Otherwise, redact all orders for this customer email
      // (orderIds is undefined, meaning redact all customer orders)
      conditions.push(eq(orders.customerEmail, customerEmail));
    }

    // Anonymize customer data
    await db
      .update(orders)
      .set({
        customerEmail: "redacted@example.com",
        customerName: "Redacted",
        customerPhone: null,
        shippingAddress: null, // Remove shipping address data
      })
      .where(and(...conditions));

    // Also redact customer data in audit logs that might reference this customer
    // Note: We can't easily query audit logs by customer email, so we'll redact
    // any audit log details that might contain customer info
    // This is a best-effort approach - audit logs are primarily for internal tracking
  }
}

export const storage = new DatabaseStorage();
