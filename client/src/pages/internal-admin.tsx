import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Gift,
  type LucideIcon,
  RefreshCw,
  Search,
  Shield,
  Store,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type InternalShop = {
  id: string;
  shopDomain: string;
  tier: "free" | "paid";
  status: string;
  monthlyOrderCount: number;
  allTimeOrderCount: number;
  orderLimit: number;
  currentBillingPeriodEnd: string | null;
  shopifyChargeId: string | null;
  totalOrders: number;
  flaggedOrders: number;
  lastOrderAt: string | null;
  merchantEmail: string | null;
  merchantName: string | null;
};

type InternalAdminResponse = {
  shops: InternalShop[];
  summary: {
    total: number;
    free: number;
    paid: number;
    complimentary: number;
    flaggedOrders: number;
  };
};

function getStoredToken() {
  return window.localStorage.getItem("internal-admin-token") || "";
}

function encodeStoreKey(shopDomain: string) {
  return btoa(shopDomain)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function internalAdminRequest<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch {
      // Keep status text.
    }
    throw new Error(`${response.status}: ${message}`);
  }

  return response.json();
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysRemaining(value: string | null) {
  if (!value) return null;
  return Math.max(
    0,
    Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );
}

function periodLabel(shop: InternalShop) {
  if (shop.tier === "paid" && shop.status === "active") {
    return "Active";
  }

  const value = shop.currentBillingPeriodEnd;
  if (!value) return "No end date";

  const days = daysRemaining(value);
  if (days === 0 && new Date(value).getTime() < Date.now()) {
    return "Expired";
  }

  return `${days} days left`;
}

function PlanBadge({ shop }: { shop: InternalShop }) {
  if (shop.status === "complimentary") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        Complimentary
      </Badge>
    );
  }

  if (shop.status === "frozen") {
    return (
      <Badge className="bg-sky-600 text-white hover:bg-sky-600">
        Frozen
      </Badge>
    );
  }

  if (shop.tier === "paid") {
    if (shop.status !== "active") {
      return <Badge variant="secondary">Paid {shop.status}</Badge>;
    }

    return <Badge>Paid</Badge>;
  }

  return <Badge variant="secondary">Free</Badge>;
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function InternalAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState(getStoredToken);
  const [draftToken, setDraftToken] = useState(getStoredToken);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);

  const adminQuery = useQuery<InternalAdminResponse>({
    queryKey: ["/api/internal/admin/shops", token],
    queryFn: () =>
      internalAdminRequest<InternalAdminResponse>(
        "/api/internal/admin/shops",
        token
      ),
    enabled: token.length > 0,
    retry: false,
  });

  const grantMutation = useMutation({
    mutationFn: (shopDomain: string) =>
      internalAdminRequest(
        `/api/internal/admin/shops/${encodeURIComponent(
          shopDomain
        )}/grant-complimentary`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ days }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/internal/admin/shops", token],
      });
      toast({
        title: "Complimentary access granted",
        description: `The shop now has ${days} days of unlimited access.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Grant failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (shopDomain: string) =>
      internalAdminRequest(
        `/api/internal/admin/shops/${encodeURIComponent(
          shopDomain
        )}/revoke-complimentary`,
        token,
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/internal/admin/shops", token],
      });
      toast({
        title: "Complimentary access revoked",
        description: "The shop is back on the free plan.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Revoke failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const shops = adminQuery.data?.shops || [];
  const filteredShops = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return shops;

    return shops.filter((shop) =>
      [
        shop.shopDomain,
        shop.merchantEmail,
        shop.merchantName,
        shop.tier,
        shop.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [search, shops]);

  const saveToken = () => {
    window.localStorage.setItem("internal-admin-token", draftToken);
    setToken(draftToken);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-background">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Internal Admin
              </h1>
              <p className="text-sm text-muted-foreground">
                Store subscriptions and temporary access
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => adminQuery.refetch()}
            disabled={!token || adminQuery.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <div className="space-y-2">
            <Label htmlFor="admin-token">Admin token</Label>
            <Input
              id="admin-token"
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              placeholder="Internal admin token"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="complimentary-days">Gift days</Label>
            <Input
              id="complimentary-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={saveToken} className="w-full md:w-auto">
              Unlock
            </Button>
          </div>
        </div>

        {adminQuery.error && (
          <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {(adminQuery.error as Error).message}
          </div>
        )}

        {adminQuery.data && (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                title="Stores"
                value={adminQuery.data.summary.total}
                icon={Store}
              />
              <StatCard
                title="Free"
                value={adminQuery.data.summary.free}
                icon={XCircle}
              />
              <StatCard
                title="Paid"
                value={adminQuery.data.summary.paid}
                icon={CheckCircle2}
              />
              <StatCard
                title="Gifted"
                value={adminQuery.data.summary.complimentary}
                icon={Gift}
              />
              <StatCard
                title="Flagged"
                value={adminQuery.data.summary.flaggedOrders}
                icon={CalendarClock}
              />
            </div>

            <div className="mb-4 flex items-center gap-2">
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search shops, email, plan..."
                  className="pl-9"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                {filteredShops.length} shown
              </div>
            </div>

            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Store</TableHead>
                    <TableHead>Plan</TableHead>
                        <TableHead>Period usage</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShops.map((shop) => {
                    const isComplimentary = shop.status === "complimentary";
                    const mutationBusy =
                      grantMutation.isPending || revokeMutation.isPending;

                    return (
                      <TableRow key={shop.shopDomain}>
                        <TableCell>
                          <div className="font-medium">{shop.shopDomain}</div>
                          <div className="text-xs text-muted-foreground">
                            {shop.merchantEmail || shop.merchantName || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <PlanBadge shop={shop} />
                            {shop.shopifyChargeId && (
                              <span className="text-xs text-muted-foreground">
                                Charge {shop.shopifyChargeId}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">
                            {shop.monthlyOrderCount}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            / {shop.orderLimit === -1 ? "∞" : shop.orderLimit}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>{shop.totalOrders} total</div>
                          <div className="text-xs text-muted-foreground">
                            {shop.flaggedOrders} flagged total
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            {shop.tier === "paid" && shop.status === "active"
                              ? "Unlimited"
                              : formatDate(shop.currentBillingPeriodEnd)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {periodLabel(shop)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" asChild>
                              <a
                                href={`/webhook-ops/internal/${encodeStoreKey(
                                  shop.shopDomain
                                )}`}
                              >
                                <Activity className="mr-2 h-4 w-4" />
                                Ops
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                grantMutation.mutate(shop.shopDomain)
                              }
                              disabled={mutationBusy}
                            >
                              <Gift className="mr-2 h-4 w-4" />
                              Gift
                            </Button>
                            {isComplimentary && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  revokeMutation.mutate(shop.shopDomain)
                                }
                                disabled={mutationBusy}
                              >
                                Revoke
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
