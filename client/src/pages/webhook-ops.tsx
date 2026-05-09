import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryClient } from "@/lib/queryClient";

type WebhookDeliveryStatus = "queued" | "processing" | "processed" | "failed";

interface WebhookDeliveryRow {
  id: string;
  deliveryId: string;
  topic: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: string;
  processedAt: string;
  failedAt: string | null;
}

interface WebhookOpsData {
  shop: string;
  generatedAt: string;
  rollup: {
    total: number;
    receivedLastHour: number;
    failedLastDay: number;
    staleQueuedOrProcessing: number;
  };
  statusCounts: Partial<Record<WebhookDeliveryStatus, number>>;
  queue: {
    status: string;
    queues?: string[];
    error?: string;
  };
  recentDeliveries: WebhookDeliveryRow[];
  failedDeliveries: WebhookDeliveryRow[];
  staleDeliveries: WebhookDeliveryRow[];
}

const statusVariant: Record<WebhookDeliveryStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  processing: "secondary",
  processed: "default",
  failed: "destructive",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: number | string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function DeliveryTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: WebhookDeliveryRow[];
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section-header">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant={statusVariant[row.status]}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {row.topic}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(row.deliveryId)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.attemptCount}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(row.receivedAt)}
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate text-muted-foreground">
                    {row.lastError || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WebhookOps() {
  const { data, isLoading, error } = useQuery<WebhookOpsData>({
    queryKey: ["/api/webhook-ops"],
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/webhook-ops"] });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <Skeleton className="h-10 w-64" />
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="mt-4 h-96" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load webhook operations data.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const processedCount = data.statusCounts.processed ?? 0;
  const failedCount = data.statusCounts.failed ?? 0;
  const activeCount =
    (data.statusCounts.queued ?? 0) + (data.statusCounts.processing ?? 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-page-title mb-2">Webhook Ops</h2>
            <p className="text-sm text-muted-foreground">
              {data.shop} - Updated {formatDate(data.generatedAt)}
            </p>
          </div>
          <Button variant="outline" onClick={refresh} data-testid="button-refresh-webhook-ops">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {data.rollup.staleQueuedOrProcessing > 0 || data.rollup.failedLastDay > 0 ? (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This shop has webhook deliveries that need review.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="Total deliveries"
            value={data.rollup.total}
            detail={`${data.rollup.receivedLastHour} received in the last hour`}
            icon={Activity}
          />
          <StatCard
            title="Processed"
            value={processedCount}
            detail="Completed delivery records"
            icon={CheckCircle2}
          />
          <StatCard
            title="Active"
            value={activeCount}
            detail="Queued or processing"
            icon={Clock3}
          />
          <StatCard
            title="Failed"
            value={failedCount}
            detail={`${data.rollup.failedLastDay} failed in the last 24h`}
            icon={AlertTriangle}
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-section-header">Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={data.queue.status === "active" ? "default" : "destructive"}>
                  {data.queue.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Queues</span>
                <span className="font-mono text-xs">
                  {data.queue.queues?.join(", ") || "-"}
                </span>
              </div>
              {data.queue.error ? (
                <p className="text-sm text-destructive">{data.queue.error}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-section-header">Status Mix</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              {(["queued", "processing", "processed", "failed"] as const).map((status) => (
                <div key={status} className="flex items-center justify-between rounded-md border p-3">
                  <Badge variant={statusVariant[status]}>{status}</Badge>
                  <span className="font-semibold tabular-nums">
                    {data.statusCounts[status] ?? 0}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 space-y-4">
          <DeliveryTable
            title="Stale queued or processing"
            rows={data.staleDeliveries}
            emptyText="No stale queued or processing deliveries."
          />
          <DeliveryTable
            title="Failed deliveries"
            rows={data.failedDeliveries}
            emptyText="No failed deliveries."
          />
          <DeliveryTable
            title="Recent deliveries"
            rows={data.recentDeliveries}
            emptyText="No webhook deliveries recorded yet."
          />
        </div>
      </main>
    </div>
  );
}
