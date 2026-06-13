import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Clock, Shield, Webhook, Settings, Loader2, LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

export interface OnboardingStatus {
  appInstalled: boolean;
  webhooksReceived: boolean;
  lastWebhookReceivedAt: string | null;
  totalOrdersProcessed: number;
  lastOrderReceivedAt: string | null;
  lastOrderNumber: string | null;
  detectionConfigured: boolean;
  detectionSettings: {
    matchEmail: boolean;
    matchPhone: boolean;
    matchAddress: boolean;
    matchSku: boolean;
    timeWindowHours: number;
  } | null;
  piiAccessLikelyBlocked: boolean;
  subscription: {
    tier: string;
    status: string;
    quotaUsed: number;
    quotaLimit: number;
    quotaPercent: number;
  };
}

export function isOnboardingFullyHealthy(status?: OnboardingStatus) {
  return !!(
    status &&
    status.webhooksReceived &&
    status.totalOrdersProcessed > 0 &&
    !status.piiAccessLikelyBlocked &&
    status.detectionConfigured
  );
}

interface StatusItemProps {
  icon: React.ElementType;
  label: string;
  status: "ok" | "warning" | "pending";
  detail?: React.ReactNode;
  action?: React.ReactNode;
}

function StatusItem({ icon: Icon, label, status, detail, action }: StatusItemProps) {
  const colors = {
    ok: "text-green-600",
    warning: "text-amber-600",
    pending: "text-muted-foreground",
  };
  const bgColors = {
    ok: "bg-green-50 dark:bg-green-950/30",
    warning: "bg-amber-50 dark:bg-amber-950/30",
    pending: "bg-muted/50",
  };
  const StatusIcon = status === "ok" ? CheckCircle2 : status === "warning" ? AlertTriangle : Clock;

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${bgColors[status]}`}>
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${colors[status]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          <StatusIcon className={`h-3.5 w-3.5 ${colors[status]}`} />
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{detail}</p>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/**
 * OnboardingChecklist — shown on the Dashboard for merchants who haven't yet
 * processed any orders (totalOrdersProcessed === 0) OR who have issues.
 * Collapses once the app is fully configured and working.
 */
export function OnboardingChecklist() {
  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    refetchInterval: 30000,
  });

  // Don't show if stable: orders are flowing AND no PII issues AND webhooks working
  const isFullyHealthy = isOnboardingFullyHealthy(status);

  if (isLoading) {
    return (
      <Card className="mb-6 border-primary/15">
        <CardContent className="p-4 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Checking setup status…</span>
        </CardContent>
      </Card>
    );
  }

  // Once the app is healthy and has processed orders, hide the checklist
  if (isFullyHealthy) return null;

  if (!status) return null;

  const search = window.location.search;
  const supportParams = new URLSearchParams(search);
  supportParams.set("source", "customer_data_access");
  const supportPath = `/support?${supportParams.toString()}`;

  // Determine webhook status
  const webhookStatus = status.webhooksReceived ? "ok" : "warning";
  const webhookDetail = status.webhooksReceived
    ? status.lastWebhookReceivedAt
      ? `Last webhook received ${formatDistanceToNow(new Date(status.lastWebhookReceivedAt), { addSuffix: true })}`
      : "Webhooks are active"
    : "No webhooks received yet. A new order in your store will trigger the first one. If you've had recent orders and see nothing here, try reinstalling the app.";

  // Orders processing
  const orderStatus = status.totalOrdersProcessed === 0 ? "pending" : "ok";
  const orderDetail =
    status.totalOrdersProcessed === 0
      ? "Waiting for the first order to arrive. Place a test order in your store to verify detection is working."
      : status.lastOrderNumber
      ? `Last processed: Order #${status.lastOrderNumber} · ${formatDistanceToNow(new Date(status.lastOrderReceivedAt!), { addSuffix: true })}`
      : `${status.totalOrdersProcessed} orders processed`;

  // PII access
  const piiStatus = status.piiAccessLikelyBlocked ? "warning" : "ok";
  const piiDetail = status.piiAccessLikelyBlocked
    ? "Some customer fields are not available yet, so email-based duplicate detection may be limited. Contact support and we'll check this store's access/setup."
    : "Customer data is accessible — email-based matching is operational.";

  // Detection config
  const configStatus = status.detectionConfigured ? "ok" : "warning";
  const configDetail = status.detectionConfigured
    ? `Active: ${[
        status.detectionSettings?.matchEmail && "Email",
        status.detectionSettings?.matchPhone && "Phone",
        status.detectionSettings?.matchAddress && "Address",
        status.detectionSettings?.matchSku && "SKU",
      ]
        .filter(Boolean)
        .join(", ")} · ${status.detectionSettings?.timeWindowHours}h window`
    : "No matching criteria enabled. Go to Settings to configure detection rules.";

  const hasAnyIssue =
    webhookStatus === "warning" ||
    piiStatus === "warning" ||
    configStatus === "warning";

  return (
    <Card className={`mb-6 ${hasAnyIssue ? "border-amber-500/40" : "border-primary/15"}`}>
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {hasAnyIssue ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              {hasAnyIssue ? "Setup Checklist — Action Required" : "App Setup — Nearly Ready"}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Complete these steps to start detecting duplicate orders
            </CardDescription>
          </div>
          <Badge variant={hasAnyIssue ? "outline" : "secondary"} className="shrink-0 text-xs">
            {status.subscription.tier === "paid" ? "Unlimited" : "Free Plan"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {/* Step 1: App installed */}
        <StatusItem
          icon={Shield}
          label="App Installed"
          status="ok"
          detail="OAuth connection is active and secure."
        />

        {/* Step 2: Webhooks */}
        <StatusItem
          icon={Webhook}
          label="Order Webhooks"
          status={webhookStatus}
          detail={webhookDetail}
          action={
            webhookStatus === "warning" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                asChild
                data-testid="button-check-webhook-status"
              >
                <a href={`/settings${search}`}>Check Webhook Status</a>
              </Button>
            ) : undefined
          }
        />

        {/* Step 3: PII access */}
        <StatusItem
          icon={Shield}
          label="Customer Data Access"
          status={piiStatus}
          detail={piiDetail}
          action={
            piiStatus === "warning" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                asChild
                data-testid="button-fix-pii-access"
              >
                <a href={supportPath}>
                  <LifeBuoy className="h-3.5 w-3.5 mr-1" />
                  Contact Support
                </a>
              </Button>
            ) : undefined
          }
        />

        {/* Step 4: Detection config */}
        <StatusItem
          icon={Settings}
          label="Detection Rules"
          status={configStatus}
          detail={configDetail}
          action={
            configStatus === "warning" ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" asChild data-testid="button-configure-detection">
                <a href={`/settings${search}`}>Configure Rules</a>
              </Button>
            ) : undefined
          }
        />

        {/* Step 5: First order */}
        <StatusItem
          icon={Clock}
          label="First Order Processed"
          status={orderStatus}
          detail={orderDetail}
        />
      </CardContent>
    </Card>
  );
}
