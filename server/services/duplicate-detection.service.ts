import { db } from "../db";
import { orders, detectionSettings, auditLogs } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import type { Order, InsertOrder } from "@shared/schema";

interface DuplicateMatch {
  order: Order;
  matchReason: string;
  confidence: number;
}

export class DuplicateDetectionService {
  /**
   * Find potential duplicates for a new order based on detection settings
   */
  async findDuplicates(newOrder: InsertOrder): Promise<DuplicateMatch | null> {
    const [settings] = await db.select().from(detectionSettings).limit(1);
    
    if (!settings) {
      return null;
    }

    const timeThreshold = new Date();
    timeThreshold.setHours(timeThreshold.getHours() - settings.timeWindowHours);

    let existingOrders: Order[] = [];

    if (settings.matchEmail) {
      const ordersByEmail = await db
        .select()
        .from(orders)
        .where(
          and(
            gte(orders.createdAt, timeThreshold),
            eq(orders.customerEmail, newOrder.customerEmail)
          )
        );
      existingOrders = [...existingOrders, ...ordersByEmail];
    }

    if (settings.matchPhone && newOrder.customerPhone) {
      const ordersByPhone = await db
        .select()
        .from(orders)
        .where(
          and(
            gte(orders.createdAt, timeThreshold),
            eq(orders.customerPhone, newOrder.customerPhone)
          )
        );
      
      for (const order of ordersByPhone) {
        if (!existingOrders.find(o => o.id === order.id)) {
          existingOrders.push(order);
        }
      }
    }

    if (existingOrders.length === 0) {
      return null;
    }

    for (const existingOrder of existingOrders) {
      const match = this.calculateMatch(newOrder, existingOrder, settings);
      if (match && match.confidence >= 70) {
        return {
          order: existingOrder,
          matchReason: match.reason,
          confidence: match.confidence,
        };
      }
    }

    return null;
  }

  /**
   * Calculate match confidence and reason between two orders
   */
  private calculateMatch(
    newOrder: InsertOrder,
    existingOrder: Order,
    settings: any
  ): { reason: string; confidence: number } | null {
    let confidence = 0;
    const reasons: string[] = [];

    if (settings.matchEmail && newOrder.customerEmail === existingOrder.customerEmail) {
      confidence += 40;
      reasons.push("Same email");
    }

    if (settings.matchPhone && newOrder.customerPhone && existingOrder.customerPhone) {
      if (newOrder.customerPhone === existingOrder.customerPhone) {
        confidence += 30;
        reasons.push("Same phone");
      }
    }

    if (settings.matchAddress && newOrder.shippingAddress && existingOrder.shippingAddress) {
      const addressMatch = this.compareAddresses(
        newOrder.shippingAddress,
        existingOrder.shippingAddress,
        settings.addressSensitivity
      );
      if (addressMatch > 0) {
        confidence += addressMatch;
        reasons.push("Similar address");
      }
    }

    if (newOrder.customerName && existingOrder.customerName) {
      if (newOrder.customerName.toLowerCase() === existingOrder.customerName.toLowerCase()) {
        confidence += 20;
        reasons.push("Same name");
      }
    }

    if (confidence < 70) {
      return null;
    }

    return {
      reason: reasons.join(", ") || "Potential duplicate detected",
      confidence: Math.min(100, confidence),
    };
  }

  /**
   * Compare shipping addresses based on sensitivity setting
   */
  private compareAddresses(
    addr1: any,
    addr2: any,
    sensitivity: string
  ): number {
    if (!addr1 || !addr2) return 0;

    let score = 0;

    const normalizeString = (str: string | undefined) => 
      (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const address1Match = normalizeString(addr1.address1) === normalizeString(addr2.address1);
    const cityMatch = normalizeString(addr1.city) === normalizeString(addr2.city);
    const zipMatch = normalizeString(addr1.zip) === normalizeString(addr2.zip);

    if (sensitivity === "high") {
      if (address1Match && cityMatch && zipMatch) {
        score = 40;
      }
    } else if (sensitivity === "medium") {
      if ((address1Match && cityMatch) || (address1Match && zipMatch)) {
        score = 30;
      }
    } else if (sensitivity === "low") {
      if (address1Match || (cityMatch && zipMatch)) {
        score = 25;
      }
    }

    return score;
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(orderId: string, action: string, details: any) {
    await db.insert(auditLogs).values({
      orderId,
      action,
      details,
    });
  }
}

export const duplicateDetectionService = new DuplicateDetectionService();
