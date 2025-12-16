import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { useAppBridge } from "@shopify/app-bridge-react"; // Removed v3
// import { Redirect } from "@shopify/app-bridge/actions"; // Removed v3
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Zap, CreditCard, AlertCircle, Flag } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Header } from "@/components/Header";

interface Subscription {
  id: string;
  shopifyShopDomain: string;
  tier: "free" | "paid";
  status: string;
  monthlyOrderCount: number;
  orderLimit: number;
  currentBillingPeriodStart: string;
  currentBillingPeriodEnd: string | null;
  shopifyChargeId: string | null;
}

function SubscriptionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const { data: subscription, isLoading } = useQuery<Subscription>({
    queryKey: ["/api/subscription"],
  });

  // const app = useAppBridge(); // Removed v3 hook
  const upgradeMutation = useMutation({
    mutationFn: async () => {
      setUpgradeLoading(true);
      const params = new URLSearchParams(window.location.search);
      const returnUrl = `${window.location.origin}/subscription?upgrade=success${params.toString() ? `&${params.toString()}` : ''}`;

      const res = await apiRequest("POST", "/api/subscription/upgrade", {
        returnUrl,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.confirmationUrl) {
        // Redirect to Shopify billing confirmation
        // In App Bridge v4, we can use window.open to navigate to the confirmation URL
        // We target "_top" to ensure we break out of the iframe if needed for the billing flow
        // although Shopify might handle it within the iframe if it's an admin link, 
        // billing confirmation usually requires a full page redirect.

        if (window.shopify && window.shopify.open) {
          // Use App Bridge open if available (safest for embedded apps)
          try {
            window.shopify.open(data.confirmationUrl, "_top");
          } catch (err) {
            // If App Bridge open fails, fall back to direct navigation
            console.error(
              "[Subscription] Failed to use App Bridge open, falling back to window.location",
              err
            );
            try {
              // Check if window.top is accessible (may be null in cross-origin iframes)
              if (window.top && window.top !== window) {
                window.top.location.href = data.confirmationUrl;
              } else {
                // Fallback to current window if top is not accessible
                window.location.href = data.confirmationUrl;
              }
            } catch (securityErr) {
              // SecurityError can occur when accessing window.top.location in cross-origin iframes
              console.error(
                "[Subscription] SecurityError accessing window.top.location, using current window",
                securityErr
              );
              window.location.href = data.confirmationUrl;
            }
          }
        } else {
          // Fallback
          try {
            // Check if window.top is accessible (may be null in cross-origin iframes)
            if (window.top && window.top !== window) {
              window.top.location.href = data.confirmationUrl;
            } else {
              // Fallback to current window if top is not accessible
              window.location.href = data.confirmationUrl;
            }
          } catch (securityErr) {
            // SecurityError can occur when accessing window.top.location in cross-origin iframes
            console.error(
              "[Subscription] SecurityError accessing window.top.location, using current window",
              securityErr
            );
            window.location.href = data.confirmationUrl;
          }
        }
      } else {
        toast({
          title: "Upgrade initiated",
          description: "Redirecting to Shopify to complete payment...",
        });
      }
      setUpgradeLoading(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Upgrade failed",
        description: error.message,
        variant: "destructive",
      });
      setUpgradeLoading(false);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (chargeId: string) => {
      const res = await apiRequest("POST", "/api/subscription/activate", {
        chargeId: parseInt(chargeId),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({
        title: "Upgrade successful!",
        description: "Your subscription has been activated.",
      });
      // Clean URL but preserve context params
      const params = new URLSearchParams(window.location.search);
      params.delete("upgrade");
      params.delete("charge_id");
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState({}, "", newUrl);
    },
    onError: (error: Error) => {
      toast({
        title: "Activation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/cancel");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });

      // Check if subscription entered grace period or was downgraded immediately
      const subscription = data.subscription;
      const isGracePeriod = subscription?.status === "cancelled" && subscription?.tier === "paid";

      toast({
        title: "Subscription cancelled",
        description: isGracePeriod
          ? `Your subscription will remain active until ${subscription.currentBillingPeriodEnd ? new Date(subscription.currentBillingPeriodEnd).toLocaleDateString() : "the end of your billing period"}.`
          : "You've been downgraded to the free tier.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check for upgrade success in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgrade") === "success") {
      const chargeId = params.get("charge_id");
      if (chargeId) {
        activateMutation.mutate(chargeId);
      } else {
        // Fallback or just showing success toast (but without activation it won't work)
        // If we are here without charge_id, something might be wrong with the flow unless it was an existing active charge
        // But let's assume if charge_id is missing, we might need to check subscription status
        queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      }
    }
  }, [queryClient, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto p-6 max-w-4xl">
          <Skeleton className="h-8 w-64 mb-6" />
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto p-6 max-w-4xl">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Failed to load subscription information.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const isPaid = subscription.tier === "paid";
  const isUnlimited = subscription.orderLimit === -1;
  const usagePercentage = isUnlimited
    ? 0
    : Math.min(100, (subscription.monthlyOrderCount / subscription.orderLimit) * 100);
  const remainingOrders = isUnlimited
    ? "Unlimited"
    : Math.max(0, subscription.orderLimit - subscription.monthlyOrderCount);

  const periodEnd = subscription.currentBillingPeriodEnd
    ? new Date(subscription.currentBillingPeriodEnd)
    : null;
  const periodStart = new Date(subscription.currentBillingPeriodStart);
  const daysRemaining = periodEnd
    ? Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-page-title font-semibold mb-2">Subscription</h1>
          <p className="text-body text-muted-foreground">
            Manage your subscription and view usage statistics
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Current Plan Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Current Plan</CardTitle>
                <Badge variant={isPaid ? "default" : "secondary"}>
                  {isPaid ? "Paid" : "Free"}
                </Badge>
              </div>
              <CardDescription>
                {isPaid ? "$7.99/month - Unlimited orders" : "Free - 50 orders/month"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Monthly Usage</span>
                  <span className="font-medium">
                    {subscription.monthlyOrderCount} / {isUnlimited ? "∞" : subscription.orderLimit}
                  </span>
                </div>
                {!isUnlimited && (
                  <div className="w-full bg-secondary rounded-full h-2 mt-2">
                    <div
                      className={`h-2 rounded-full ${usagePercentage >= 90
                        ? "bg-destructive"
                        : usagePercentage >= 75
                          ? "bg-chart-4"
                          : "bg-primary"
                        }`}
                      style={{ width: `${usagePercentage}%` }}
                    />
                  </div>
                )}
                {!isUnlimited && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {remainingOrders} orders remaining this month
                  </p>
                )}
              </div>

              {periodEnd && (
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{isPaid ? "Billing Period" : "Usage Cycle"}</span>
                    <span className="font-medium">
                      {daysRemaining !== null ? `${daysRemaining} days remaining` : "Active"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Resets on {periodEnd.toLocaleDateString()}
                  </p>
                </div>
              )}

              {!isPaid && (
                <>
                  {usagePercentage >= 100 ? (
                    <Alert className="mt-4 border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        You have reached your monthly limit. Upgrade to continue processing orders.
                      </AlertDescription>
                    </Alert>
                  ) : usagePercentage >= 90 ? (
                    <Alert className="mt-4">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        You're approaching your monthly limit. Upgrade to continue processing orders.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          {/* Plan Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Plan Comparison</CardTitle>
              <CardDescription>Choose the plan that works for you</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Free</h3>
                    <span className="text-2xl font-bold">$0</span>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>50 orders/month</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>Duplicate detection</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>Dashboard access</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <X className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Email/Slack notifications</span>
                    </li>
                  </ul>
                </div>

                <div className={`border-2 rounded-lg p-4 ${isPaid ? "border-primary" : ""}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">Unlimited</h3>
                      {isPaid && <Badge>Current</Badge>}
                    </div>
                    <span className="text-2xl font-bold">$7.99</span>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span>Unlimited orders</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>All free features</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>Email/Slack notifications</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>Priority support</span>
                    </li>
                  </ul>
                  <div className="mt-4">
                    {isPaid ? (
                      subscription.status === "cancelled" ? (
                        <div className="w-full text-center p-2 border border-yellow-500/50 bg-yellow-500/10 rounded text-sm text-yellow-600 dark:text-yellow-400">
                          Cancels on {periodEnd?.toLocaleDateString()}
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => cancelMutation.mutate()}
                          disabled={cancelMutation.isPending}
                          className="w-full"
                        >
                          {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
                        </Button>
                      )
                    ) : (
                      <Button
                        onClick={() => upgradeMutation.mutate()}
                        disabled={upgradeLoading}
                        className="w-full"
                      >
                        {upgradeLoading ? (
                          "Processing..."
                        ) : (
                          <>
                            <CreditCard className="h-4 w-4 mr-2" />
                            Upgrade to Unlimited
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

export default SubscriptionPage;
