import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, AlertCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface Subscription {
    tier: string;
    monthlyOrderCount: number;
    orderLimit: number;
    currentBillingPeriodEnd: string | null;
}

export function QuotaWarningBanner() {
    const { data: subscription } = useQuery<Subscription>({
        queryKey: ['/api/subscription'],
    });

    // Don't show for paid tier (unlimited)
    if (!subscription || subscription.tier === "paid" || subscription.orderLimit === -1) {
        return null;
    }

    const usagePercentage = (subscription.monthlyOrderCount / subscription.orderLimit) * 100;

    // Don't show if below 80%
    if (usagePercentage < 80) {
        return null;
    }

    const isExceeded = usagePercentage >= 100;
    const resetDate = subscription.currentBillingPeriodEnd
        ? new Date(subscription.currentBillingPeriodEnd).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        })
        : null;

    if (isExceeded) {
        return (
            <div
                className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
                data-testid="quota-banner-exceeded"
            >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-start gap-3 flex-1">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-destructive">
                                Duplicate limit reached
                            </p>
                            <p className="text-sm text-muted-foreground">
                                You've found {subscription.monthlyOrderCount} of {subscription.orderLimit} duplicates this month.
                                New duplicates won't be flagged until your limit resets{resetDate ? ` on ${resetDate}` : ''}.
                            </p>
                        </div>
                    </div>
                    <Button asChild size="sm" className="shrink-0">
                        <Link href={`/subscription${window.location.search}`}>
                            Upgrade <ArrowRight className="ml-1 h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </div>
        );
    }

    // 80-99% warning
    return (
        <div
            className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4"
            data-testid="quota-banner-warning"
        >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 flex-1">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-yellow-700 dark:text-yellow-500">
                            Approaching duplicate limit
                        </p>
                        <p className="text-sm text-muted-foreground">
                            You've found {subscription.monthlyOrderCount} of {subscription.orderLimit} duplicates this month ({Math.round(usagePercentage)}% used).
                            {resetDate && ` Resets on ${resetDate}.`}
                        </p>
                    </div>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0 border-yellow-500/50 hover:bg-yellow-500/10">
                    <Link href={`/subscription${window.location.search}`}>
                        Upgrade <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                </Button>
            </div>
        </div>
    );
}
