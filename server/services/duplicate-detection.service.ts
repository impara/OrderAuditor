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
      `[DuplicateDetection] Settings - Email: ${settings.matchEmail}, Phone: ${settings.matchPhone}, Address: ${settings.matchAddress}, SKU: ${settings.matchSku}, TimeWindow: ${settings.timeWindowHours}h`
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
        }: confidence=${match.confidence}, reason=${match.reason || "no match"}`
      );

      if (match.confidence >= 70) {
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
   * Scoring:
   * - Email match: 50 points (strong identifier)
   * - Phone match: 50 points (strong identifier, normalized for format differences)
   * - Full address match (street + city + zip): 45 points
   * - Partial address match (street + city OR street + zip): 25 points
   * - Name match: 20 points (supporting evidence)
   * - Threshold: 70 points to flag as duplicate
   *
   * All criteria are checked "only if present" - missing data is automatically skipped.
   * This ensures digital products (no shipping address) can still be detected via email/phone.
   */
  private calculateMatch(
    newOrder: InsertOrder,
    existingOrder: Order,
    settings: any
  ): { reason: string; confidence: number } {
    let confidence = 0;
    const reasons: string[] = [];

    // Email - check only if enabled AND data exists
    if (
      settings.matchEmail &&
      newOrder.customerEmail &&
      existingOrder.customerEmail &&
      newOrder.customerEmail === existingOrder.customerEmail
    ) {
      confidence += 50;
      reasons.push("Same email");
    }

    // Phone - check only if enabled AND data exists
    if (settings.matchPhone) {
      logger.debug(
        `[DuplicateDetection] Phone match enabled. New order has phone: ${!!newOrder.customerPhone}, Existing order has phone: ${!!existingOrder.customerPhone}`
      );

      if (newOrder.customerPhone && existingOrder.customerPhone) {
        const normalizedNew = this.normalizePhoneNumber(newOrder.customerPhone);
        const normalizedExisting = this.normalizePhoneNumber(
          existingOrder.customerPhone
        );

        logger.debug(
          `[DuplicateDetection] Phone comparison - New: "${newOrder.customerPhone}" (normalized: "${normalizedNew}") vs Existing: "${existingOrder.customerPhone}" (normalized: "${normalizedExisting}")`
        );

        if (normalizedNew === normalizedExisting) {
          confidence += 50;
          reasons.push("Same phone");
          logger.debug(`[DuplicateDetection] Phone match found!`);
        } else {
          logger.debug(`[DuplicateDetection] Phone numbers don't match after normalization`);
        }
      } else {
        logger.debug(
          `[DuplicateDetection] Phone match skipped - phone missing on ${!newOrder.customerPhone ? 'new' : 'existing'} order`
        );
      }
    }

    // Address - check only if enabled AND data exists
    if (settings.matchAddress) {
      logger.debug(
        `[DuplicateDetection] Address match enabled. New order has address: ${!!newOrder.shippingAddress}, Existing order has address: ${!!existingOrder.shippingAddress}`
      );

      if (newOrder.shippingAddress && existingOrder.shippingAddress) {
        const addressScore = this.compareAddresses(
          newOrder.shippingAddress,
          existingOrder.shippingAddress
        );
        
        logger.debug(
          `[DuplicateDetection] Address comparison score: ${addressScore} (45=full match, 25=partial match, 0=no match)`
        );

        if (addressScore > 0) {
          confidence += addressScore;
          reasons.push(addressScore >= 45 ? "Same address" : "Similar address");
          logger.debug(
            `[DuplicateDetection] Address match! New: "${newOrder.shippingAddress?.address1}, ${newOrder.shippingAddress?.city}, ${newOrder.shippingAddress?.zip}" vs Existing: "${existingOrder.shippingAddress?.address1}, ${existingOrder.shippingAddress?.city}, ${existingOrder.shippingAddress?.zip}"`
          );
        } else {
          logger.debug(`[DuplicateDetection] Addresses don't match`);
        }
      } else {
        logger.debug(
          `[DuplicateDetection] Address match skipped - address missing on ${!newOrder.shippingAddress ? 'new' : 'existing'} order`
        );
      }
    }

    // Name - always check if data exists (supporting evidence)
    if (newOrder.customerName && existingOrder.customerName) {
      if (
        newOrder.customerName.toLowerCase() ===
        existingOrder.customerName.toLowerCase()
      ) {
        confidence += 20;
        reasons.push("Same name");
      }
    }

    // SKU Match - check only if enabled AND data exists
    if (settings.matchSku) {
      logger.debug(
        `[DuplicateDetection] SKU match enabled. New order has lineItems: ${!!newOrder.lineItems}, Existing order has lineItems: ${!!existingOrder.lineItems}`
      );

      if (
        newOrder.lineItems &&
        existingOrder.lineItems &&
        Array.isArray(newOrder.lineItems) &&
        Array.isArray(existingOrder.lineItems)
      ) {
        const newSkus = newOrder.lineItems
          .map((item: any) => item.sku)
          .filter((sku: any) => sku);
        const existingSkus = existingOrder.lineItems
          .map((item: any) => item.sku)
          .filter((sku: any) => sku);

        logger.debug(
          `[DuplicateDetection] New order SKUs: [${newSkus.join(", ")}], Existing order SKUs: [${existingSkus.join(", ")}]`
        );

        const hasCommonSku = newSkus.some((sku: string) =>
          existingSkus.includes(sku)
        );

        if (hasCommonSku) {
          confidence += 50;
          reasons.push("Same SKU purchased");
          logger.debug(`[DuplicateDetection] SKU match found!`);
        } else {
          logger.debug(`[DuplicateDetection] No SKU match found`);
        }
      } else {
        logger.debug(`[DuplicateDetection] SKU match skipped - lineItems missing or not arrays`);
      }
    }

    return {
      reason: reasons.join(", ") || "No significant match",
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
   * Compare shipping addresses
   * Returns 45 points for full match (street + city + zip)
   * Returns 25 points for partial match (street + city OR street + zip)
   */
  private compareAddresses(addr1: any, addr2: any): number {
    if (!addr1 || !addr2) return 0;

    const normalizeString = (str: string | undefined) =>
      (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const address1Match =
      normalizeString(addr1.address1) === normalizeString(addr2.address1);
    const cityMatch =
      normalizeString(addr1.city) === normalizeString(addr2.city);
    const zipMatch = normalizeString(addr1.zip) === normalizeString(addr2.zip);

    // Full match: all three components match
    if (address1Match && cityMatch && zipMatch) {
      return 45;
    }

    // Partial match: street + (city OR zip)
    if ((address1Match && cityMatch) || (address1Match && zipMatch)) {
      return 25;
    }

    return 0;
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
