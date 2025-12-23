import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, TrendingUp, TrendingDown, DollarSign, Clock, Flag, Package, MapPin, Mail, Phone, Calendar, X, Menu, ChevronRight } from "lucide-react";
import type { Order, DashboardStats } from "@shared/schema";
import { format } from "date-fns";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Header } from "@/components/Header";

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
    <Card data-testid={`card-stat-${title.toLowerCase().replace(/\s+/g, '-')}`} className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 p-4">
        <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-xl sm:text-2xl font-bold text-foreground">{value}</div>
        {trend !== undefined && (
          <div className="flex items-center gap-1 mt-1">
            <TrendIcon className={`h-3 w-3 ${isPositiveTrend ? 'text-chart-1' : 'text-destructive'}`} />
            <span className={`text-xs ${isPositiveTrend ? 'text-chart-1' : 'text-destructive'}`}>
              {Math.abs(trend)}%
            </span>
            {trendLabel && (
              <span className="text-xs text-muted-foreground hidden sm:inline">{trendLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 90) {
    return <Badge variant="destructive" className="whitespace-nowrap" data-testid="badge-confidence-high">High ({confidence}%)</Badge>;
  } else if (confidence >= 70) {
    return <Badge className="bg-chart-4 text-white hover:bg-chart-4/90 whitespace-nowrap" data-testid="badge-confidence-medium">Medium ({confidence}%)</Badge>;
  }
  return <Badge variant="secondary" className="whitespace-nowrap" data-testid="badge-confidence-low">Low ({confidence}%)</Badge>;
}

function EmptyState() {
  return (
    <Card className="mt-4 border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Package className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No duplicate orders detected</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
          Your detection rules are running. We'll notify you when duplicates are found.
        </p>
        <Button variant="outline" asChild data-testid="button-adjust-settings">
          <a href={`/settings${window.location.search}`}>Adjust Detection Settings</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function OrderDetailsModal({ order, isOpen, onClose }: { order: Order; isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const dismissMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiRequest("POST", `/api/orders/${orderId}/dismiss`);
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/orders/flagged'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });

      toast({
        title: "Order dismissed",
        description: `Order #${order.orderNumber} has been dismissed and removed from the flagged list.`,
      });

      setShowDismissDialog(false);
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error dismissing order",
        description: error.message,
        variant: "destructive",
      });
      setIsDismissing(false);
    },
  });

  const handleDismiss = () => {
    setIsDismissing(true);
    dismissMutation.mutate(order.id);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-order-details">
          <DialogHeader>
            <DialogTitle className="text-xl">Order #{order.orderNumber} Details</DialogTitle>
            <DialogDescription>
              Review detailed information about this flagged order
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Duplicate Detection
              </h3>
              <div className="bg-muted/50 rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Confidence Score</span>
                  {order.matchConfidence != null && <ConfidenceBadge confidence={order.matchConfidence} />}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Match Reason</span>
                  <span className="text-sm font-medium">{order.matchReason}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Flagged Date</span>
                  <span className="text-sm font-medium">
                    {order.flaggedAt ? format(new Date(order.flaggedAt), 'MMM d, yyyy h:mm a') : '-'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Order Information
              </h3>
              <div className="bg-muted/50 rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Order ID</span>
                  <span className="text-sm font-medium font-mono">{order.shopifyOrderId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Order Total</span>
                  <span className="text-sm font-medium">{order.currency} ${order.totalPrice}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Created
                  </span>
                  <span className="text-sm font-medium">
                    {format(new Date(order.createdAt), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Customer Information</h3>
              <div className="bg-muted/50 rounded-md p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {order.customerName?.charAt(0) || order.customerEmail?.charAt(0).toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="overflow-hidden">
                    <div className="text-sm font-medium truncate">{order.customerName || 'Unknown Customer'}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <Mail className="h-3 w-3 shrink-0" />
                      {order.customerEmail || 'No Email'}
                    </div>
                  </div>
                </div>
                {order.customerPhone && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground pt-2">
                    <Phone className="h-3 w-3" />
                    {order.customerPhone}
                  </div>
                )}
              </div>
            </div>

            {order.shippingAddress && (
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Shipping Address
                </h3>
                <div className="bg-muted/50 rounded-md p-4">
                  <div className="text-sm space-y-1">
                    {order.shippingAddress.address1 && <div>{order.shippingAddress.address1}</div>}
                    {order.shippingAddress.address2 && <div>{order.shippingAddress.address2}</div>}
                    <div>
                      {[
                        order.shippingAddress.city,
                        order.shippingAddress.province,
                        order.shippingAddress.zip
                      ].filter(Boolean).join(', ')}
                    </div>
                    {order.shippingAddress.country && <div>{order.shippingAddress.country}</div>}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-4">
              <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-close-details">
                Close
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => setShowDismissDialog(true)}
                data-testid="button-dismiss-order"
              >
                <X className="h-4 w-4 mr-2" />
                Dismiss Order
              </Button>
              <Button variant="default" className="flex-1" asChild data-testid="button-view-in-shopify">
                <a
                  href={`https://${order.shopDomain || 'admin.shopify.com'}/admin/orders/${order.shopifyOrderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View in Shopify
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDismissDialog} onOpenChange={setShowDismissDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the "Merge_Review_Candidate" tag from this order in Shopify and remove it from the flagged orders list.
              The order will still be kept in the database for historical tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDismissing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismiss}
              disabled={isDismissing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-dismiss"
            >
              {isDismissing ? "Dismissing..." : "Dismiss Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MobileOrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  return (
    <Card className="mb-3 active:scale-[0.99] transition-transform" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="font-semibold text-sm">#{order.orderNumber}</div>
            <div className="text-xs text-muted-foreground">
              {order.flaggedAt ? format(new Date(order.flaggedAt), 'MMM d, h:mm a') : '-'}
            </div>
          </div>
          <div className="text-right">
            {order.matchConfidence && <ConfidenceBadge confidence={order.matchConfidence} />}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {order.customerName?.charAt(0) || order.customerEmail?.charAt(0).toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
          <div className="overflow-hidden">
            <div className="text-sm font-medium truncate">{order.customerName || 'Unknown'}</div>
            <div className="text-xs text-muted-foreground truncate">{order.customerEmail || 'No Email'}</div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="text-sm font-medium">
            {order.currency} ${order.totalPrice}
          </div>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-primary hover:text-primary/80">
            View Details <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FlaggedOrdersTable({ orders }: { orders: Order[] }) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  return (
    <>
      {/* Desktop Table View */}
      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Flagged Orders</CardTitle>
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
                  className="hover-elevate cursor-pointer"
                  onClick={() => setSelectedOrder(order)}
                  data-testid={`row-order-${order.id}`}
                >
                  <TableCell className="font-semibold" data-testid={`text-order-number-${order.id}`}>
                    #{order.orderNumber}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {order.customerName?.charAt(0) || order.customerEmail?.charAt(0).toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium" data-testid={`text-customer-name-${order.id}`}>
                          {order.customerName || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-customer-email-${order.id}`}>
                          {order.customerEmail || 'No Email'}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOrder(order);
                      }}
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

      {/* Mobile List View */}
      <div className="md:hidden space-y-3">
        <h3 className="text-lg font-semibold mb-2 px-1">Flagged Orders</h3>
        {orders.map((order) => (
          <MobileOrderCard
            key={order.id}
            order={order}
            onClick={() => setSelectedOrder(order)}
          />
        ))}
      </div>

      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          isOpen={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </>
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
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
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

          <div className="w-full lg:w-80 order-1 lg:order-2">
            {statsLoading ? (
              <div className="grid grid-cols-2 lg:flex lg:flex-col gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 lg:flex lg:flex-col gap-3">
                <StatsCard
                  title="Total Flagged"
                  value={stats.totalFlagged}
                  icon={AlertCircle}
                  trend={stats.totalFlaggedTrend}
                  trendLabel="vs last 7d"
                />
                <StatsCard
                  title="Potential Value"
                  value={`$${stats.potentialDuplicateValue.toLocaleString()}`}
                  icon={DollarSign}
                />
                <StatsCard
                  title="Flagged Today"
                  value={stats.ordersFlaggedToday}
                  icon={Flag}
                />
                <StatsCard
                  title="Avg Resolution"
                  value={`${stats.averageResolutionTime}h`}
                  icon={Clock}
                />
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
