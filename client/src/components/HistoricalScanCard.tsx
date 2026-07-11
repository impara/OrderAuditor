import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type HistoricalScan = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  ordersFetched: number;
  matchesFound: number;
  candidateCapExceeded: boolean;
  errorMessage: string | null;
};

export function HistoricalScanCard() {
  const queryClient = useQueryClient();
  const invalidatedRun = useRef<string | null>(null);
  const { data: scan, isLoading } = useQuery<HistoricalScan | null>({
    queryKey: ["/api/historical-scan/latest"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/historical-scan/latest");
      return response.json();
    },
    refetchInterval: (query) => {
      const status = (query.state.data as HistoricalScan | null | undefined)?.status;
      return status === "queued" || status === "running" ? 2500 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/historical-scan");
      return response.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/historical-scan/latest"] });
    },
  });

  useEffect(() => {
    if (scan?.status === "completed" && invalidatedRun.current !== scan.id) {
      invalidatedRun.current = scan.id;
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/flagged"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    }
  }, [queryClient, scan]);

  if (isLoading) {
    return null;
  }

  let icon = <Search className="h-5 w-5 text-primary" />;
  let title = "Checking your recent orders is ready";
  let description = "Run a read-only check of the last 60 days of orders.";
  let action: ReactNode = (
    <Button
      size="sm"
      onClick={() => startMutation.mutate()}
      disabled={startMutation.isPending}
    >
      {startMutation.isPending ? "Starting…" : "Start recent-order scan"}
    </Button>
  );

  if (scan?.status === "queued" || scan?.status === "running") {
    icon = <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    title = "Scanning your recent orders…";
    description = "This read-only check runs in the background. You can keep using the app.";
    action = null;
  } else if (scan?.status === "completed") {
    icon = <CheckCircle2 className="h-5 w-5 text-green-600" />;
    title =
      scan.matchesFound > 0
        ? `${scan.ordersFetched} orders checked · ${scan.matchesFound} duplicate-looking ${
            scan.matchesFound === 1 ? "group" : "groups"
          } found`
        : `${scan.ordersFetched} orders checked · no duplicate-looking matches found`;
    description = scan.candidateCapExceeded
      ? "High-volume periods were partially checked. Review the results below while live monitoring continues."
      : "The results are shown below. Future new orders continue to be checked normally.";
    action = null;
  } else if (scan?.status === "failed") {
    icon = <AlertTriangle className="h-5 w-5 text-amber-600" />;
    title = "We couldn’t complete the recent-order scan";
    description = scan.errorMessage || "Retry the same read-only scan window.";
    action = (
      <Button
        size="sm"
        variant="outline"
        onClick={() => startMutation.mutate()}
        disabled={startMutation.isPending}
      >
        {startMutation.isPending ? "Retrying…" : "Retry scan"}
      </Button>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{icon}</div>
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
