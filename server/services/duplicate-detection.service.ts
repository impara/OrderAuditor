import { db } from "../db";
import { orders, detectionSettings, auditLogs } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import type { Order, InsertOrder } from "@shared/schema";
import { logger } from "../utils/logger";

interface DuplicateMatch {
  order: Order;
  matchReason: string;
  confidence: number;
}

export class DuplicateDetectionService {
  /**
   * Find potential duplicates for a new order based on detection settings
   */
  async findDuplicates(newOrder: InsertOrder, shopDomain: string): Promise<DuplicateMatch | null> {
    // Filter settings by shopDomain for multi-tenant support
    const [settings] = await db
      .select()
      .from(detectionSettings)
      .where(eq(detectionSettings.shopDomain, shopDomain))
      .limit(1);
    
    if (!settings) {
      logger.warn(`[DuplicateDetection] No settings found for shop: ${shopDomain}`);
      return null;
    }

    logger.debug(
      `[DuplicateDetection] Settings - Email: ${settings.matchEmail}, Phone: ${settings.matchPhone}, Address: ${settings.matchAddress}, TimeWindow: ${settings.timeWindowHours}h`
    );

    const timeThreshold = new Date();
    timeThreshold.setHours(timeThreshold.getHours() - settings.timeWindowHours);
    logger.debug(
      `[DuplicateDetection] Looking for orders created after: ${timeThreshold.toISOString()}`
    );

    let existingOrders: Order[] = [];

    if (settings.matchEmail) {
      logger.debug(
        `[DuplicateDetection] Searching for orders with email: ${newOrder.customerEmail}`
      );
      const ordersByEmail = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shopDomain), // Filter by shopDomain
            gte(orders.createdAt, timeThreshold),
            eq(orders.customerEmail, newOrder.customerEmail)
          )
        );
      logger.debug(
        `[DuplicateDetection] Found ${ordersByEmail.length} orders matching email`
      );
      existingOrders = [...existingOrders, ...ordersByEmail];
    }

    if (settings.matchPhone && newOrder.customerPhone) {
      const ordersByPhone = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shopDomain), // Filter by shopDomain
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
      logger.debug(
        `[DuplicateDetection] No existing orders found to compare against`
      );
      return null;
    }

    logger.debug(
      `[DuplicateDetection] Comparing against ${existingOrders.length} existing order(s)`
    );

    for (const existingOrder of existingOrders) {
      const match = this.calculateMatch(newOrder, existingOrder, settings);
      logger.debug(
        `[DuplicateDetection] Match with order ${existingOrder.orderNumber}: confidence=${match?.confidence || 0}, reason=${match?.reason || "no match"}`
      );
      if (match && match.confidence >= 70) {
        logger.info(
          `[DuplicateDetection] ✅ Duplicate found! Order ${existingOrder.orderNumber} matches with ${match.confidence}% confidence`
        );
        return {
          order: existingOrder,
          matchReason: match.reason,
          confidence: match.confidence,
        };
      }
    }

    logger.debug(`[DuplicateDetection] No duplicate match found (confidence < 70%)`);
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
