import { 
  orders, 
  detectionSettings, 
  auditLogs,
  type Order, 
  type InsertOrder,
  type DetectionSettings,
  type InsertDetectionSettings,
  type UpdateDetectionSettings,
  type AuditLog,
  type InsertAuditLog,
  type DashboardStats
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, sql, and } from "drizzle-orm";

export interface IStorage {
  getOrder(id: string): Promise<Order | undefined>;
  getFlaggedOrders(): Promise<Order[]>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: string, updates: Partial<Order>): Promise<Order>;
  getDashboardStats(): Promise<DashboardStats>;
  
  getSettings(): Promise<DetectionSettings | undefined>;
  updateSettings(updates: UpdateDetectionSettings): Promise<DetectionSettings>;
  initializeSettings(): Promise<DetectionSettings>;
  
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
}

export class DatabaseStorage implements IStorage {
  async getOrder(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
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
    const [order] = await db
      .insert(orders)
      .values(insertOrder)
      .returning();
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
        and(
          eq(orders.isFlagged, true),
          gte(orders.flaggedAt, sevenDaysAgo)
        )
      );

    const [totalValueResult] = await db
      .select({ sum: sql<number>`COALESCE(SUM(CAST(total_price AS NUMERIC)), 0)` })
      .from(orders)
      .where(eq(orders.isFlagged, true));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayFlaggedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.isFlagged, true),
          gte(orders.flaggedAt, today)
        )
      );

    const totalFlagged = totalFlaggedResult?.count || 0;
    const lastWeekFlagged = lastWeekFlaggedResult?.count || 0;
    const previousWeekCount = totalFlagged - lastWeekFlagged;
    
    let totalFlaggedTrend = 0;
    if (previousWeekCount > 0) {
      totalFlaggedTrend = Math.round(((lastWeekFlagged - previousWeekCount) / previousWeekCount) * 100);
    }

    return {
      totalFlagged,
      totalFlaggedTrend,
      potentialDuplicateValue: parseFloat(totalValueResult?.sum?.toString() || "0"),
      ordersFlaggedToday: todayFlaggedResult?.count || 0,
      averageResolutionTime: 2.5,
    };
  }

  async getSettings(): Promise<DetectionSettings | undefined> {
    const [settings] = await db.select().from(detectionSettings).limit(1);
    return settings || undefined;
  }

  async updateSettings(updates: UpdateDetectionSettings): Promise<DetectionSettings> {
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
    const [log] = await db
      .insert(auditLogs)
      .values(insertLog)
      .returning();
    return log;
  }
}

export const storage = new DatabaseStorage();
