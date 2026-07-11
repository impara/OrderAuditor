import { db } from "../db";
import { storage } from "../storage";
import { orders, detectionSettings } from "@shared/schema";
import { eq, and, gte, lte, ne, desc } from "drizzle-orm";
import type { Order, InsertOrder } from "@shared/schema";
import { logger } from "../utils/logger";
import { normalizePhoneNumber } from "../utils/phone";

const FUZZY_CANDIDATE_LIMIT = parseInt(
  process.env.DUPLICATE_FUZZY_CANDIDATE_LIMIT || "500",
  10
);

export interface DuplicateMatch {
  order: Order;
  matchReason: string;
  confidence: number;
}

export interface DuplicateDetectionMetadata {
  candidateCapExceeded: boolean;
}

type FuzzyCandidateOrder = Pick<
  Order,
  | "id"
  | "shopDomain"
  | "shopifyOrderId"
  | "orderNumber"
  | "customerEmail"
  | "customerName"
  | "customerPhone"
  | "customerPhoneNormalized"
  | "shippingAddress"
  | "lineItems"
  | "createdAt"
>;

export class DuplicateDetectionService {
  /**
   * Find potential duplicates for a new order based on detection settings
   */
  async findDuplicates(
    newOrder: InsertOrder,
    shopDomain: string,
    metadata: DuplicateDetectionMetadata = { candidateCapExceeded: false }
  ): Promise<DuplicateMatch | null> {
    let [settings] = await db
      .select()
      .from(detectionSettings)
      .where(eq(detectionSettings.shopDomain, shopDomain))
      .limit(1);

    if (!settings) {
      logger.info(
        `[DuplicateDetection] No settings for shop ${shopDomain}, initializing defaults`
      );
      const initialized = await storage.initializeSettings(shopDomain);
      settings = initialized;
    }

    logger.debug(
      `[DuplicateDetection] Settings - Email: ${settings.matchEmail}, Phone: ${settings.matchPhone}, Address: ${settings.matchAddress}, SKU: ${settings.matchSku}, TimeWindow: ${settings.timeWindowHours}h`
    );

    const parsedReferenceTime = newOrder.createdAt
      ? new Date(newOrder.createdAt)
      : new Date();
    const referenceTime = Number.isNaN(parsedReferenceTime.getTime())
      ? new Date()
      : parsedReferenceTime;
    const timeThreshold = new Date(
      referenceTime.getTime() - settings.timeWindowHours * 60 * 60 * 1000
    );
    logger.debug(
      `[DuplicateDetection] Looking for orders created after: ${timeThreshold.toISOString()}`
    );

    let existingOrders: Order[] = [];
    let ordersInWindow: FuzzyCandidateOrder[] | null = null;
    const addCandidateOrders = (candidateOrders: Array<Order | FuzzyCandidateOrder>) => {
      for (const order of candidateOrders) {
        const candidateTime = new Date(order.createdAt).getTime();
        if (
          order.shopifyOrderId === newOrder.shopifyOrderId ||
          candidateTime < timeThreshold.getTime() ||
          candidateTime > referenceTime.getTime()
        ) {
          continue;
        }
        if (!existingOrders.find((existing) => existing.id === order.id)) {
          existingOrders.push(order as Order);
        }
      }
    };
    const loadOrdersInWindow = async (reason: string) => {
      if (ordersInWindow) {
        return ordersInWindow;
      }

      logger.debug(
        `[DuplicateDetection] Loading time-window candidate orders for ${reason}`
      );

      const candidateRows = await db
        .select({
          id: orders.id,
          shopDomain: orders.shopDomain,
          shopifyOrderId: orders.shopifyOrderId,
          orderNumber: orders.orderNumber,
          customerEmail: orders.customerEmail,
          customerName: orders.customerName,
          customerPhone: orders.customerPhone,
          customerPhoneNormalized: orders.customerPhoneNormalized,
          shippingAddress: orders.shippingAddress,
          lineItems: orders.lineItems,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shopDomain),
            gte(orders.createdAt, timeThreshold),
            lte(orders.createdAt, referenceTime),
            ne(orders.shopifyOrderId, newOrder.shopifyOrderId)
          )
        )
        .orderBy(desc(orders.createdAt))
        .limit(FUZZY_CANDIDATE_LIMIT + 1);

      if (candidateRows.length > FUZZY_CANDIDATE_LIMIT) {
        metadata.candidateCapExceeded = true;
        logger.warn(
          `[DuplicateDetection] Fuzzy candidate cap (${FUZZY_CANDIDATE_LIMIT}) reached for shop ${shopDomain}. Older matches in the time window may be missed.`
        );
      }

      ordersInWindow = candidateRows.slice(0, FUZZY_CANDIDATE_LIMIT);

      logger.debug(
        `[DuplicateDetection] Found ${ordersInWindow.length} orders in time window`
      );

      return ordersInWindow;
    };

    if (settings.matchEmail && newOrder.customerEmail) {
      logger.debug(
        `[DuplicateDetection] Searching for orders with email: ${newOrder.customerEmail}`
      );
      const ordersByEmail = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.shopDomain, shopDomain),
            gte(orders.createdAt, timeThreshold),
            lte(orders.createdAt, referenceTime),
            ne(orders.shopifyOrderId, newOrder.shopifyOrderId),
            eq(orders.customerEmail, newOrder.customerEmail)
          )
        );
      logger.debug(
        `[DuplicateDetection] Found ${ordersByEmail.length} orders matching email`
      );
      addCandidateOrders(ordersByEmail);
    } else if (settings.matchEmail && !newOrder.customerEmail) {
      logger.debug(
        `[DuplicateDetection] Email matching enabled but new order has no email. Skipping email-based search.`
      );
    }

    if (settings.matchPhone && newOrder.customerPhone) {
      const normalizedPhone = normalizePhoneNumber(newOrder.customerPhone);
      logger.debug(
        `[DuplicateDetection] Searching for orders with phone: ${newOrder.customerPhone} (normalized: ${normalizedPhone})`
      );

      if (normalizedPhone) {
        const ordersByPhone = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.shopDomain, shopDomain),
              gte(orders.createdAt, timeThreshold),
              lte(orders.createdAt, referenceTime),
              ne(orders.shopifyOrderId, newOrder.shopifyOrderId),
              eq(orders.customerPhoneNormalized, normalizedPhone)
            )
          );

        logger.debug(
          `[DuplicateDetection] Found ${ordersByPhone.length} orders matching normalized phone`
        );
        addCandidateOrders(ordersByPhone);
      }
    }

    if (settings.matchSku) {
      const newSkus = this.extractSkus(newOrder.lineItems);
      if (newSkus.length > 0) {
        const allOrdersInWindow = await loadOrdersInWindow("SKU comparison");
        const ordersBySku = allOrdersInWindow.filter((order) =>
          this.hasCommonSku(newSkus, order.lineItems)
        );

        logger.debug(
          `[DuplicateDetection] Found ${ordersBySku.length} candidate orders sharing SKU`
        );

        addCandidateOrders(ordersBySku);
      } else {
        logger.debug(
          `[DuplicateDetection] SKU matching enabled but new order has no SKUs. Skipping SKU candidate search.`
        );
      }
    }

    if (settings.matchAddress) {
      if (newOrder.shippingAddress) {
        const allOrdersInWindow = await loadOrdersInWindow("address comparison");
        const ordersByAddress = allOrdersInWindow.filter((order) =>
          this.compareAddresses(newOrder.shippingAddress, order.shippingAddress) > 0
        );

        logger.debug(
          `[DuplicateDetection] Found ${ordersByAddress.length} candidate orders with matching address`
        );

        addCandidateOrders(ordersByAddress);
      } else {
        logger.debug(
          `[DuplicateDetection] Address matching enabled but new order has no shipping address. Skipping address candidate search.`
        );
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

  private calculateMatch(
    newOrder: InsertOrder,
    existingOrder: Order,
    settings: any
  ): { reason: string; confidence: number } {
    let confidence = 0;
    const reasons: string[] = [];

    if (
      settings.matchEmail &&
      newOrder.customerEmail &&
      existingOrder.customerEmail &&
      newOrder.customerEmail === existingOrder.customerEmail
    ) {
      confidence += 50;
      reasons.push("Same email");
    }

    if (settings.matchPhone) {
      if (newOrder.customerPhone && existingOrder.customerPhone) {
        const normalizedNew = normalizePhoneNumber(newOrder.customerPhone);
        const normalizedExisting =
          existingOrder.customerPhoneNormalized ||
          normalizePhoneNumber(existingOrder.customerPhone);

        if (normalizedNew && normalizedExisting && normalizedNew === normalizedExisting) {
          confidence += 50;
          reasons.push("Same phone");
        }
      }
    }

    if (settings.matchAddress) {
      if (newOrder.shippingAddress && existingOrder.shippingAddress) {
        const addressScore = this.compareAddresses(
          newOrder.shippingAddress,
          existingOrder.shippingAddress
        );

        if (addressScore > 0) {
          confidence += addressScore;
          reasons.push(addressScore >= 45 ? "Same address" : "Similar address");
        }
      }
    }

    const newCustomerName = newOrder.customerName?.trim();
    const existingCustomerName = existingOrder.customerName?.trim();
    if (
      newCustomerName &&
      existingCustomerName &&
      newCustomerName.toLowerCase() !== "unknown" &&
      existingCustomerName.toLowerCase() !== "unknown"
    ) {
      if (
        newCustomerName.toLowerCase() === existingCustomerName.toLowerCase()
      ) {
        confidence += 20;
        reasons.push("Same name");
      }
    }

    if (settings.matchSku) {
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

        const hasCommonSku = newSkus.some((sku: string) =>
          existingSkus.includes(sku)
        );

        if (hasCommonSku) {
          confidence += 50;
          reasons.push("Same SKU purchased");
        }
      }
    }

    return {
      reason: reasons.join(", ") || "No significant match",
      confidence: Math.min(100, confidence),
    };
  }

  private extractSkus(lineItems: InsertOrder["lineItems"] | Order["lineItems"]): string[] {
    if (!lineItems || !Array.isArray(lineItems)) {
      return [];
    }

    return lineItems
      .map((item) => item.sku)
      .filter((sku): sku is string => typeof sku === "string" && sku.trim().length > 0);
  }

  private hasCommonSku(
    newSkus: string[],
    existingLineItems: Order["lineItems"]
  ): boolean {
    if (newSkus.length === 0) {
      return false;
    }

    const existingSkus = this.extractSkus(existingLineItems);
    return newSkus.some((sku) => existingSkus.includes(sku));
  }

  private compareAddresses(addr1: any, addr2: any): number {
    if (!addr1 || !addr2) return 0;

    const normalizeString = (str: string | undefined) =>
      (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const sameNonEmptyValue = (
      first: string | undefined,
      second: string | undefined
    ) => {
      const normalizedFirst = normalizeString(first);
      const normalizedSecond = normalizeString(second);
      return Boolean(normalizedFirst) && normalizedFirst === normalizedSecond;
    };

    const address1Match = sameNonEmptyValue(addr1.address1, addr2.address1);
    const cityMatch = sameNonEmptyValue(addr1.city, addr2.city);
    const zipMatch = sameNonEmptyValue(addr1.zip, addr2.zip);

    if (address1Match && cityMatch && zipMatch) {
      return 50;
    }

    if ((address1Match && cityMatch) || (address1Match && zipMatch)) {
      return 25;
    }

    return 0;
  }
}

export const duplicateDetectionService = new DuplicateDetectionService();
