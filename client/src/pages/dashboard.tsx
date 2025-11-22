import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertCircle, TrendingUp, TrendingDown, DollarSign, Clock, Flag, Package } from "lucide-react";
import type { Order, DashboardStats } from "@shared/schema";
import { format } from "date-fns";

function StatsCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  trendLabel 
}: { 
  title: string; 
  value: string | number; 
  icon: any; 
  trend?: number; 
  trendLabel?: string;
}) {
  const isPositiveTrend = trend !== undefined && trend >= 0;
  const TrendIcon = isPositiveTrend ? TrendingUp : TrendingDown;
  
  return (
    <Card data-testid={`card-stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-data-label text-muted-foreground font-medium">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-stats-number text-foreground">{value}</div>
        {trend !== undefined && (
          <div className="flex items-center gap-1 mt-1">
            <TrendIcon className={`h-3 w-3 ${isPositiveTrend ? 'text-chart-1' : 'text-destructive'}`} />
            <span className={`text-xs ${isPositiveTrend ? 'text-chart-1' : 'text-destructive'}`}>
              {Math.abs(trend)}%
            </span>
            {trendLabel && (
              <span className="text-xs text-muted-foreground">{trendLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 90) {
    return <Badge variant="destructive" data-testid="badge-confidence-high">High ({confidence}%)</Badge>;
  } else if (confidence >= 70) {
    return <Badge className="bg-chart-4 text-white hover:bg-chart-4/90" data-testid="badge-confidence-medium">Medium ({confidence}%)</Badge>;
  }
  return <Badge variant="secondary" data-testid="badge-confidence-low">Low ({confidence}%)</Badge>;
}

function EmptyState() {
  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Package className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-section-header mb-2">No duplicate orders detected</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
          Your detection rules are running. We'll notify you when duplicates are found.
        </p>
        <Button variant="outline" asChild data-testid="button-adjust-settings">
          <a href="/settings">Adjust Detection Settings</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function FlaggedOrdersTable({ orders }: { orders: Order[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section-header">Flagged Orders</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Order Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Match Reason</TableHead>
              <TableHead className="text-right">Order Total</TableHead>
              <TableHead>Date Flagged</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow 
                key={order.id} 
                className="hover-elevate" 
                data-testid={`row-order-${order.id}`}
              >
                <TableCell className="font-semibold" data-testid={`text-order-number-${order.id}`}>
                  #{order.orderNumber}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {order.customerName?.charAt(0) || order.customerEmail.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-medium" data-testid={`text-customer-name-${order.id}`}>
                        {order.customerName || 'Unknown'}
                      </div>
                      <div className="text-xs text-muted-foreground" data-testid={`text-customer-email-${order.id}`}>
                        {order.customerEmail}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {order.matchConfidence && <ConfidenceBadge confidence={order.matchConfidence} />}
                  <div className="text-xs text-muted-foreground mt-1" data-testid={`text-match-reason-${order.id}`}>
                    {order.matchReason}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium" data-testid={`text-order-total-${order.id}`}>
                  {order.currency} ${order.totalPrice}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground" data-testid={`text-flagged-date-${order.id}`}>
                  {order.flaggedAt ? format(new Date(order.flaggedAt), 'MMM d, yyyy') : '-'}
                </TableCell>
                <TableCell className="text-right">
                  <Button 
                    size="sm" 
                    variant="ghost"
                    data-testid={`button-view-details-${order.id}`}
                  >
                    View Details
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    refetchInterval: 30000,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders/flagged'],
    refetchInterval: 30000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background sticky top-0 z-10">
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
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 order-2 lg:order-1">
            {ordersLoading ? (
              <Card>
                <CardContent className="p-6">
                  <Skeleton className="h-64 w-full" />
                </CardContent>
              </Card>
            ) : orders && orders.length > 0 ? (
              <FlaggedOrdersTable orders={orders} />
            ) : (
              <EmptyState />
            )}
          </div>

          <div className="w-full lg:w-80 order-1 lg:order-2 space-y-4">
            {statsLoading ? (
              <>
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </>
            ) : stats ? (
              <>
                <StatsCard
                  title="Total Flagged Orders"
                  value={stats.totalFlagged}
                  icon={AlertCircle}
                  trend={stats.totalFlaggedTrend}
                  trendLabel="vs last 7 days"
                />
                <StatsCard
                  title="Potential Duplicate Value"
                  value={`$${stats.potentialDuplicateValue.toLocaleString()}`}
                  icon={DollarSign}
                />
                <StatsCard
                  title="Orders Flagged Today"
                  value={stats.ordersFlaggedToday}
                  icon={Flag}
                />
                <StatsCard
                  title="Avg Resolution Time"
                  value={`${stats.averageResolutionTime}h`}
                  icon={Clock}
                />
              </>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
