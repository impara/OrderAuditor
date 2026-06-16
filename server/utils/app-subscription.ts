const TERMINAL_PENDING_STATUSES = new Set(["EXPIRED", "DECLINED"]);

export function parseAppSubscriptionChargeId(
  appSubscription: Record<string, unknown>
): string | null {
  if (appSubscription.id != null && appSubscription.id !== "") {
    return String(appSubscription.id);
  }

  const graphqlId = appSubscription.admin_graphql_api_id;
  if (typeof graphqlId === "string") {
    const match = graphqlId.match(/AppSubscription\/(\d+)$/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Decide whether a terminal app_subscriptions/update webhook should change
 * local subscription state. Stale pending charges must not cancel an active
 * paid subscription for a different charge ID.
 */
export function shouldProcessAppSubscriptionTermination(
  webhookChargeId: string | null,
  storedChargeId: string | null,
  localStatus: string,
  localTier: string,
  webhookStatus: string
): boolean {
  if (TERMINAL_PENDING_STATUSES.has(webhookStatus)) {
    if (
      storedChargeId &&
      webhookChargeId &&
      storedChargeId !== webhookChargeId
    ) {
      return false;
    }

    if (localTier === "paid" && localStatus === "active") {
      return false;
    }
  }

  if (
    storedChargeId &&
    webhookChargeId &&
    storedChargeId !== webhookChargeId
  ) {
    return false;
  }

  return true;
}
