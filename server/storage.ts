import {
  orders,
  detectionSettings,
  auditLogs,
  subscriptions,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, sql, and } from "drizzle-orm";

export interface IStorage {
  getOrder(id: string): Promise<Order | undefined>;
  getOrderByShopifyId(shopifyOrderId: string): Promise<Order | undefined>;
  getFlaggedOrders(): Promise<Order[]>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: string, updates: Partial<Order>): Promise<Order>;
  getDashboardStats(): Promise<DashboardStats>;

  getSettings(): Promise<DetectionSettings | undefined>;
  updateSettings(updates: UpdateDetectionSettings): Promise<DetectionSettings>;
  initializeSettings(): Promise<DetectionSettings>;

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

  dismissOrder(orderId: string): Promise<Order>;
  resolveOrder(orderId: string, resolvedBy: string): Promise<Order>;
}

export class DatabaseStorage implements IStorage {
  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order || undefined;
  }

  async getOrderByShopifyId(
    shopifyOrderId: string
  ): Promise<Order | undefined> {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.shopifyOrderId, shopifyOrderId));
    return order || undefined;
  }

  async getFlaggedOrders(): Promise<Order[]> {
    return await db
      .select()
      .from(orders)
      .where(eq(orders.isFlagged, true))
      .orderBy(desc(orders.flaggedAt));
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const [order] = await db.insert(orders).values(insertOrder).returning();
    return order;
  }

  async updateOrder(id: string, updates: Partial<Order>): Promise<Order> {
    const [order] = await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, id))
      .returning();
    return order;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const [totalFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.isFlagged, true));

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [lastWeekFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(eq(orders.isFlagged, true), gte(orders.flaggedAt, sevenDaysAgo))
      );

    const [totalValueResult] = await db
      .select({
        sum: sql<number>`COALESCE(SUM(CAST(total_price AS NUMERIC)), 0)`,
      })
      .from(orders)
      .where(eq(orders.isFlagged, true));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.isFlagged, true), gte(orders.flaggedAt, today)));

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

  async getSettings(): Promise<DetectionSettings | undefined> {
    const [settings] = await db.select().from(detectionSettings).limit(1);
    return settings || undefined;
  }

  async updateSettings(
    updates: UpdateDetectionSettings
  ): Promise<DetectionSettings> {
    let existing = await this.getSettings();

    if (!existing) {
      existing = await this.initializeSettings();
    }

    const [updated] = await db
      .update(detectionSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(detectionSettings.id, existing.id))
      .returning();

    return updated;
  }

  async initializeSettings(): Promise<DetectionSettings> {
    const existing = await this.getSettings();
    if (existing) {
      return existing;
    }

    const [settings] = await db
      .insert(detectionSettings)
      .values({
        timeWindowHours: 24,
        matchEmail: true,
        matchPhone: false,
        matchAddress: true,
        addressSensitivity: "medium",
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

  async dismissOrder(orderId: string): Promise<Order> {
    return this.resolveOrder(orderId, "manual_dashboard");
  }

  async resolveOrder(orderId: string, resolvedBy: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (!order.isFlagged) {
      throw new Error(`Order ${orderId} is not currently flagged`);
    }

    return this.updateOrder(orderId, {
      isFlagged: false,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy as
        | "manual_dashboard"
        | "shopify_tag_removed"
        | "auto_merged",
    });
  }
}

export const storage = new DatabaseStorage();
