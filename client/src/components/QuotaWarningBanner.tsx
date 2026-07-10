import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, AlertCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { getQuotaStatus, type QuotaSubscription } from "@/lib/quotaStatus";

export function QuotaWarningBanner() {
    const { data: subscription } = useQuery<QuotaSubscription>({
        queryKey: ['/api/subscription'],
    });

    const quotaStatus = getQuotaStatus(subscription);
    if (quotaStatus.state === "hidden") {
        return null;
    }

    const isExceeded = quotaStatus.state === "exceeded";
    const resetDate = quotaStatus.resetDate
        ? quotaStatus.resetDate.toLocaleDateString('en-US', {
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
                                Duplicate flag limit reached
                            </p>
                            <p className="text-sm text-muted-foreground">
                                You've used {quotaStatus.used} of {quotaStatus.limit} duplicate flags this cycle.
                                New duplicate-looking orders won't be tagged or flagged until reset{resetDate ? ` on ${resetDate}` : ''}. Upgrade to keep protection active.
                            </p>
                        </div>
                    </div>
                    <Button asChild size="sm" className="shrink-0">
                        <Link href={`/subscription${window.location.search}`}>
                            Keep flagging <ArrowRight className="ml-1 h-4 w-4" />
                        </Link>
                    </Button>
                </div>
            </div>
        );
    }

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
                            Approaching duplicate flag limit
                        </p>
                        <p className="text-sm text-muted-foreground">
                            You've used {quotaStatus.used} of {quotaStatus.limit} duplicate flags this cycle ({Math.round(quotaStatus.usagePercentage)}% used).
                            {resetDate && ` Resets on ${resetDate}.`} Upgrade before the limit to keep flagged-order review uninterrupted.
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
