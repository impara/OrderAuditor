import { logger } from "../utils/logger";
import type { Subscription } from "@shared/schema";
import {
  BillingSnapshotError,
  shopifyBillingService,
  type ShopifyBillingSnapshot,
} from "./shopify-billing.service";
import { subscriptionService } from "./subscription.service";

export type BillingReconciliationOutcome =
  | { kind: "synced_active"; chargeSuffix: string; periodEnd: Date }
  | { kind: "would_sync_active"; chargeSuffix: string; periodEnd: Date }
  | { kind: "already_consistent"; chargeSuffix: string; periodEnd: Date }
  | { kind: "multiple_active"; chargeSuffixes: string[] }
  | { kind: "no_active"; latestStatus: string | null }
  | { kind: "unverified"; reason: string };

type BillingReader = {
  getBillingSnapshot(shop: string, token: string): Promise<ShopifyBillingSnapshot>;
};

type SubscriptionWriter = {
  getSubscription(shop: string): Promise<Subscription>;
  activatePaidSubscription(
    shop: string,
    chargeId?: string | number | null,
    accessToken?: string,
    currentPeriodEnd?: Date
  ): Promise<Subscription>;
};

function chargeIdFromGid(gid: string): string | null {
  return gid.match(/AppSubscription\/(\d+)$/)?.[1] ?? null;
}

function chargeSuffix(id: string): string {
  return id.slice(-6);
}

export class BillingReconciliationService {
  constructor(
    private readonly billing: BillingReader = shopifyBillingService,
    private readonly subscriptions: SubscriptionWriter = subscriptionService
  ) {}

  async reconcileActive(
    shop: string,
    accessToken: string,
    options: { apply?: boolean } = {}
  ): Promise<BillingReconciliationOutcome> {
    const apply = options.apply ?? true;
    let snapshot: ShopifyBillingSnapshot;
    try {
      snapshot = await this.billing.getBillingSnapshot(shop, accessToken);
    } catch (error) {
      const reason =
        error instanceof BillingSnapshotError
          ? error.message
          : "Unexpected Shopify billing query failure";
      logger.warn(`[BillingReconciliation] Unverified billing state for ${shop}: ${reason}`);
      return { kind: "unverified", reason };
    }

    if (snapshot.active.length > 1) {
      const chargeSuffixes = snapshot.active.map((item) => {
        const id = chargeIdFromGid(item.id) ?? item.id;
        return chargeSuffix(id);
      });
      logger.error(
        `[BillingReconciliation] Multiple active subscriptions for ${shop}: ${chargeSuffixes.join(",")}`
      );
      return { kind: "multiple_active", chargeSuffixes };
    }

    if (snapshot.active.length === 0) {
      const latestStatus = snapshot.history[0]?.status ?? null;
      logger.warn(
        `[BillingReconciliation] No active Shopify subscription for ${shop}; local state was not changed`
      );
      return { kind: "no_active", latestStatus };
    }

    const active = snapshot.active[0];
    const chargeId = chargeIdFromGid(active.id);
    if (!chargeId || !active.currentPeriodEnd) {
      return {
        kind: "unverified",
        reason: "Active Shopify subscription is missing an ID or period end",
      };
    }

    const periodEnd = new Date(active.currentPeriodEnd);
    if (Number.isNaN(periodEnd.getTime())) {
      return { kind: "unverified", reason: "Invalid Shopify period end" };
    }

    const local = await this.subscriptions.getSubscription(shop);
    const isConsistent =
      local.tier === "paid" &&
      local.status === "active" &&
      local.orderLimit === -1 &&
      local.shopifyChargeId === chargeId &&
      local.currentBillingPeriodEnd?.getTime() === periodEnd.getTime();

    if (isConsistent || !apply) {
      return {
        kind: isConsistent ? "already_consistent" : "would_sync_active",
        chargeSuffix: chargeSuffix(chargeId),
        periodEnd,
      };
    }

    await this.subscriptions.activatePaidSubscription(
      shop,
      chargeId,
      accessToken,
      periodEnd
    );
    logger.info(
      `[BillingReconciliation] Synced active subscription for ${shop} charge ...${chargeSuffix(chargeId)}`
    );
    return { kind: "synced_active", chargeSuffix: chargeSuffix(chargeId), periodEnd };
  }
}

export const billingReconciliationService = new BillingReconciliationService();
