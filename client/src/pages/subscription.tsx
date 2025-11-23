import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Zap, CreditCard, AlertCircle, Flag } from "lucide-react";
import { useState, useEffect } from "react";

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
    queryKey: ["subscription"],
    queryFn: async () => {
      const res = await fetch("/api/subscription");
      if (!res.ok) throw new Error("Failed to fetch subscription");
      return res.json();
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      setUpgradeLoading(true);
      const res = await fetch("/api/subscription/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/subscription?upgrade=success`,
        }),
      });
      if (!res.ok) throw new Error("Failed to create upgrade charge");
      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      if (data.confirmationUrl) {
        // Redirect to Shopify billing confirmation
        window.location.href = data.confirmationUrl;
      } else {
        toast({
          title: "Upgrade initiated",
          description: "Redirecting to Shopify to complete payment...",
        });
      }
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

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to cancel subscription");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast({
        title: "Subscription cancelled",
        description: "You've been downgraded to the free tier.",
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
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      toast({
        title: "Upgrade successful!",
        description: "Your subscription has been activated.",
      });
      // Clean URL
      window.history.replaceState({}, "", "/subscription");
    }
  }, [queryClient, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-background">
          <div className="container mx-auto px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="h-5 w-5 text-primary" />
                <h1 className="text-page-title">Order Auditor</h1>
              </div>
              <nav className="flex gap-4">
                <Button variant="ghost" asChild>
                  <a href="/" className="text-sm font-medium">Dashboard</a>
                </Button>
                <Button variant="ghost" asChild>
                  <a href="/settings" className="text-sm font-medium">Settings</a>
                </Button>
                <Button variant="ghost" asChild>
                  <a href="/subscription" className="text-sm font-medium">Subscription</a>
                </Button>
              </nav>
            </div>
          </div>
        </header>
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
        <header className="border-b border-border bg-background">
          <div className="container mx-auto px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="h-5 w-5 text-primary" />
                <h1 className="text-page-title">Order Auditor</h1>
              </div>
              <nav className="flex gap-4">
                <Button variant="ghost" asChild>
                  <a href="/" className="text-sm font-medium">Dashboard</a>
                </Button>
                <Button variant="ghost" asChild>
                  <a href="/settings" className="text-sm font-medium">Settings</a>
                </Button>
                <Button variant="ghost" asChild>
                  <a href="/subscription" className="text-sm font-medium">Subscription</a>
                </Button>
              </nav>
            </div>
          </div>
        </header>
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
      <header className="border-b border-border bg-background">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-primary" />
              <h1 className="text-page-title">Order Auditor</h1>
            </div>
            <nav className="flex gap-4">
              <Button variant="ghost" asChild data-testid="link-dashboard">
                <a href="/" className="text-sm font-medium">Dashboard</a>
              </Button>
              <Button variant="ghost" asChild data-testid="link-settings">
                <a href="/settings" className="text-sm font-medium">Settings</a>
              </Button>
              <Button variant="ghost" asChild data-testid="link-subscription">
                <a href="/subscription" className="text-sm font-medium">Subscription</a>
              </Button>
            </nav>
          </div>
        </div>
      </header>

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
                    className={`h-2 rounded-full ${
                      usagePercentage >= 90
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
                  <span className="text-muted-foreground">Billing Period</span>
                  <span className="font-medium">
                    {daysRemaining !== null ? `${daysRemaining} days remaining` : "Active"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Resets on {periodEnd.toLocaleDateString()}
                </p>
              </div>
            )}

            {usagePercentage >= 90 && !isPaid && (
              <Alert className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  You're approaching your monthly limit. Upgrade to continue processing orders.
                </AlertDescription>
              </Alert>
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
                    <Button
                      variant="outline"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                      className="w-full"
                    >
                      {cancelMutation.isPending ? "Cancelling..." : "Cancel Subscription"}
                    </Button>
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

