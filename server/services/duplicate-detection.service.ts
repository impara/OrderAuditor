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
  async findDuplicates(
    newOrder: InsertOrder,
    shopDomain: string
  ): Promise<DuplicateMatch | null> {
    // Filter settings by shopDomain for multi-tenant support
    const [settings] = await db
      .select()
      .from(detectionSettings)
      .where(eq(detectionSettings.shopDomain, shopDomain))
      .limit(1);

    if (!settings) {
      logger.warn(
        `[DuplicateDetection] No settings found for shop: ${shopDomain}`
      );
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
      // Normalize phone number for comparison (remove all non-digit characters except +)
      const normalizedPhone = this.normalizePhoneNumber(newOrder.customerPhone);
      logger.debug(
        `[DuplicateDetection] Searching for orders with phone: ${newOrder.customerPhone} (normalized: ${normalizedPhone})`
      );

      // Get all orders in time window and filter by normalized phone in memory
      // This is necessary because SQL doesn't easily support phone normalization
      const allOrdersInWindow = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shopDomain),
            gte(orders.createdAt, timeThreshold)
          )
        );

      const ordersByPhone = allOrdersInWindow.filter((order) => {
        if (!order.customerPhone) return false;
        const normalizedExisting = this.normalizePhoneNumber(
          order.customerPhone
        );
        return normalizedExisting === normalizedPhone;
      });

      logger.debug(
        `[DuplicateDetection] Found ${ordersByPhone.length} orders matching phone (after normalization)`
      );

      for (const order of ordersByPhone) {
        if (!existingOrders.find((o) => o.id === order.id)) {
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
        `[DuplicateDetection] Match with order ${
          existingOrder.orderNumber
        }: confidence=${match?.confidence || 0}, reason=${
          match?.reason || "no match"
        }`
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

    logger.debug(
      `[DuplicateDetection] No duplicate match found (confidence < 70%)`
    );
    return null;
  }

  /**
   * Calculate match confidence and reason between two orders
   *
   * Scoring philosophy:
   * - Conservative by default: Multiple criteria should combine to reach 70% threshold
   * - Respect merchant choice: If only one criterion is enabled and it matches, it's sufficient
   * - Phone and Email are equally reliable identifiers (40 points each)
   * - Address matching varies by sensitivity (25-40 points)
   * - Name matching is less reliable (20 points, supporting evidence only)
   */
  private calculateMatch(
    newOrder: InsertOrder,
    existingOrder: Order,
    settings: any
  ): { reason: string; confidence: number } | null {
    let confidence = 0;
    const reasons: string[] = [];
    const matchedCriteria: string[] = [];

    // Count how many criteria are enabled
    const enabledCriteriaCount = [
      settings.matchEmail,
      settings.matchPhone,
      settings.matchAddress,
    ].filter(Boolean).length;

    if (
      settings.matchEmail &&
      newOrder.customerEmail === existingOrder.customerEmail
    ) {
      confidence += 40;
      reasons.push("Same email");
      matchedCriteria.push("email");
    }

    if (
      settings.matchPhone &&
      newOrder.customerPhone &&
      existingOrder.customerPhone
    ) {
      const normalizedNew = this.normalizePhoneNumber(newOrder.customerPhone);
      const normalizedExisting = this.normalizePhoneNumber(
        existingOrder.customerPhone
      );

      logger.debug(
        `[DuplicateDetection] Phone comparison - New: "${newOrder.customerPhone}" (normalized: "${normalizedNew}") vs Existing: "${existingOrder.customerPhone}" (normalized: "${normalizedExisting}")`
      );

      if (normalizedNew === normalizedExisting) {
        confidence += 40; // Same reliability as email
        reasons.push("Same phone");
        matchedCriteria.push("phone");
      }
    }

    if (
      settings.matchAddress &&
      newOrder.shippingAddress &&
      existingOrder.shippingAddress
    ) {
      const addressMatch = this.compareAddresses(
        newOrder.shippingAddress,
        existingOrder.shippingAddress,
        settings.addressSensitivity
      );
      if (addressMatch > 0) {
        confidence += addressMatch;
        reasons.push("Similar address");
        matchedCriteria.push("address");
      }
    }

    // Name matching is supporting evidence only (not a primary criterion)
    if (newOrder.customerName && existingOrder.customerName) {
      if (
        newOrder.customerName.toLowerCase() ===
        existingOrder.customerName.toLowerCase()
      ) {
        confidence += 20;
        reasons.push("Same name");
      }
    }

    // Special case: If merchant enabled only ONE criterion and it matched, respect their choice
    // This allows merchants to use phone-only or email-only matching if they prefer
    if (enabledCriteriaCount === 1 && matchedCriteria.length === 1) {
      // Boost confidence to 75% to exceed threshold when single enabled criterion matches
      // This respects the merchant's explicit configuration choice
      confidence = Math.max(confidence, 75);
      logger.debug(
        `[DuplicateDetection] Single criterion match detected (${matchedCriteria[0]}), boosting confidence to respect merchant configuration`
      );
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
   * Normalize phone number for comparison
   * Removes all non-digit characters except leading +, then normalizes to E.164-like format
   */
  private normalizePhoneNumber(phone: string | null | undefined): string {
    if (!phone) return "";

    // Remove all non-digit characters except leading +
    let normalized = phone.trim();

    // If it starts with +, keep it, otherwise remove all non-digits
    if (normalized.startsWith("+")) {
      normalized = "+" + normalized.slice(1).replace(/\D/g, "");
    } else {
      normalized = normalized.replace(/\D/g, "");
      // If it's a US number without country code, assume +1
      if (normalized.length === 10) {
        normalized = "+1" + normalized;
      } else if (normalized.length === 11 && normalized.startsWith("1")) {
        normalized = "+" + normalized;
      }
    }

    return normalized;
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

    const address1Match =
      normalizeString(addr1.address1) === normalizeString(addr2.address1);
    const cityMatch =
      normalizeString(addr1.city) === normalizeString(addr2.city);
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
   * Note: This method is not currently used. Use storage.createAuditLog instead.
   */
  async createAuditLog(
    shopDomain: string,
    orderId: string,
    action: string,
    details: any
  ) {
    await db.insert(auditLogs).values({
      shopDomain,
      orderId,
      action,
      details,
    });
  }
}

export const duplicateDetectionService = new DuplicateDetectionService();
