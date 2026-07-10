export type QuotaSubscription = {
  tier: string;
  monthlyOrderCount: number;
  orderLimit: number;
  currentBillingPeriodEnd?: string | null;
};

export type QuotaStatus =
  | { state: "hidden" }
  | {
      state: "warning" | "exceeded";
      usagePercentage: number;
      remaining: number;
      used: number;
      limit: number;
      resetDate: Date | null;
    };

export function getQuotaStatus(subscription?: QuotaSubscription | null): QuotaStatus {
  if (!subscription || subscription.tier === "paid" || subscription.orderLimit === -1) {
    return { state: "hidden" };
  }

  if (subscription.orderLimit <= 0) {
    return { state: "hidden" };
  }

  const usagePercentage = Math.round(
    (subscription.monthlyOrderCount / subscription.orderLimit) * 10000
  ) / 100;
  if (usagePercentage < 80) {
    return { state: "hidden" };
  }

  return {
    state: usagePercentage >= 100 ? "exceeded" : "warning",
    usagePercentage,
    remaining: Math.max(0, subscription.orderLimit - subscription.monthlyOrderCount),
    used: subscription.monthlyOrderCount,
    limit: subscription.orderLimit,
    resetDate: subscription.currentBillingPeriodEnd
      ? new Date(subscription.currentBillingPeriodEnd)
      : null,
  };
}
