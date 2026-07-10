import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { getQuotaStatus, type QuotaSubscription } from "@/lib/quotaStatus";

export function QuotaHeaderBadge() {
    const { data: subscription } = useQuery<QuotaSubscription>({
        queryKey: ["/api/subscription"],
        staleTime: 30000,
    });

    const quotaStatus = getQuotaStatus(subscription);
    if (quotaStatus.state === "hidden") {
        return null;
    }

    const search = window.location.search;
    const isExceeded = quotaStatus.state === "exceeded";
    const Icon = isExceeded ? AlertCircle : AlertTriangle;

    return (
        <Link href={`/subscription${search}`}>
            <Badge
                variant={isExceeded ? "destructive" : "outline"}
                className={
                    isExceeded
                        ? "h-8 cursor-pointer gap-1.5 px-2.5 text-xs hover:bg-destructive/90"
                        : "h-8 cursor-pointer gap-1.5 border-amber-500/60 bg-amber-500/10 px-2.5 text-xs text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                }
                data-testid={isExceeded ? "quota-header-badge-exceeded" : "quota-header-badge-warning"}
                title={`${quotaStatus.used} of ${quotaStatus.limit} duplicate flags used this cycle`}
            >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                    {isExceeded ? "Limit reached" : "Limit soon"}
                </span>
                <span className="sm:hidden">
                    {isExceeded ? "Limit" : `${Math.round(quotaStatus.usagePercentage)}%`}
                </span>
            </Badge>
        </Link>
    );
}
