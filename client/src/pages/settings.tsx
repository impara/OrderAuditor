import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Flag, Bell, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { DetectionSettings, UpdateDetectionSettings } from "@shared/schema";
import { updateDetectionSettingsSchema } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Header } from "@/components/Header";
import { InfoTooltip } from "@/components/InfoTooltip";
import { WelcomeBanner } from "@/components/WelcomeBanner";

export default function Settings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<DetectionSettings>({
    queryKey: ['/api/settings'],
  });

  const form = useForm<UpdateDetectionSettings>({
    resolver: zodResolver(updateDetectionSettingsSchema),
    defaultValues: {
      timeWindowHours: 24,
      matchEmail: true,

      matchAddress: true,
      matchSku: false,
      enableNotifications: false,
      notificationEmail: "",
      slackWebhookUrl: "",
      notificationThreshold: 80,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        timeWindowHours: settings.timeWindowHours,
        matchEmail: settings.matchEmail,
        matchPhone: settings.matchPhone,
        matchAddress: settings.matchAddress,
        matchSku: settings.matchSku,
        enableNotifications: settings.enableNotifications,
        notificationEmail: settings.notificationEmail || "",
        slackWebhookUrl: settings.slackWebhookUrl || "",
        notificationThreshold: settings.notificationThreshold,
      });
    }
  }, [settings, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateDetectionSettings) => {
      return await apiRequest("PATCH", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({
        title: "Settings saved",
        description: "Your detection settings have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateDetectionSettings) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
        <div className="mb-6">
          <h2 className="text-page-title mb-2">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure which customer details to check for duplicates. Missing data (like addresses for digital products) is handled automatically.
          </p>
        </div>

        <WelcomeBanner />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Tabs defaultValue="detection" className="space-y-4">
              <TabsList data-testid="tabs-settings">
                <TabsTrigger value="detection" data-testid="tab-detection-rules">
                  Detection Rules
                </TabsTrigger>
                <TabsTrigger value="notifications" data-testid="tab-notifications">
                  Notifications
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detection" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-section-header">Time Window</CardTitle>
                    <CardDescription>
                      How far back should we look for potential duplicates?
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="timeWindowHours"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            Hours: {field.value}
                            <InfoTooltip
                              content="Only orders placed within this time window are compared. Recommended: 24-72 hours for most stores."
                              side="bottom"
                            />
                          </FormLabel>
                          <FormControl>
                            <Slider
                              min={1}
                              max={72}
                              step={1}
                              value={[field.value || 24]}
                              onValueChange={([value]) => field.onChange(value)}
                              data-testid="slider-time-window"
                            />
                          </FormControl>
                          <FormDescription>
                            Orders within the last {field.value} hours will be checked for duplicates. Changes apply to new orders only.
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-section-header">Matching Criteria</CardTitle>
                    <CardDescription>
                      Check the boxes for customer information you want to compare. We'll only check data that's present in the order.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="matchEmail"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel className="flex items-center gap-2">
                              Email Address
                              <InfoTooltip
                                content="Strong identifier worth 50 points. Checked only when email data exists in both orders."
                                side="bottom"
                              />
                            </FormLabel>
                            <FormDescription>
                              Flag orders with matching email addresses (50 points)
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-match-email"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="matchPhone"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel className="flex items-center gap-2">
                              Phone Number
                              <InfoTooltip
                                content="Strong identifier worth 50 points. Phone numbers are normalized to match different formats (+1234567890 vs (123) 456-7890). Checked only when phone data exists in both orders."
                                side="bottom"
                              />
                            </FormLabel>
                            <FormDescription>
                              Flag orders with matching phone numbers (50 points)
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-match-phone"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="matchAddress"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel className="flex items-center gap-2">
                              Shipping Address
                              <InfoTooltip
                                content="Worth up to 45 points for full match (street + city + zip), or 25 points for partial match. Automatically skipped for orders without shipping addresses (digital products, gift cards)."
                                side="bottom"
                              />
                            </FormLabel>
                            <FormDescription>
                              Flag orders shipping to the same address (45 points for full match, 25 for partial)
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-match-address"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* SKU Match */}
                    <FormField
                      control={form.control}
                      name="matchSku"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel className="flex items-center gap-2">
                              Product SKU
                              <InfoTooltip
                                content="Worth 50 points. Checks if the new order contains any SKU that was previously purchased by the same customer within the time window."
                                side="bottom"
                              />
                            </FormLabel>
                            <FormDescription>
                              Flag orders containing duplicate SKUs (50 points)
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-match-sku"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Warning for address-only mode */}
                    {form.watch("matchAddress") &&
                      !form.watch("matchEmail") &&
                      !form.watch("matchPhone") && (
                        <Alert variant="default" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
                          <AlertDescription className="text-sm">
                            ⚠️ <strong>Address-only matching won't flag duplicates.</strong> Address alone (45 pts) + Name (20 pts) = 65 points, which is below the 70-point threshold. Enable email or phone matching for duplicate detection to work.
                          </AlertDescription>
                        </Alert>
                      )}

                    <div className="mt-6 p-4 bg-muted rounded-lg">
                      <p className="text-sm font-medium mb-2">How Scoring Works</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Orders need <strong>70+ points</strong> to be flagged as duplicates. Each enabled criterion that matches adds points:
                      </p>
                      <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                        <li>• Email match: <strong>50 points</strong></li>
                        <li>• Phone match: <strong>50 points</strong></li>
                        <li>• Full address match (street + city + zip): <strong>45 points</strong></li>
                        <li>• Partial address match: <strong>25 points</strong></li>
                        <li>• SKU match: <strong>50 points</strong></li>
                        <li>• Name match: <strong>20 points</strong> (supporting evidence)</li>
                      </ul>
                      <div className="mt-4 space-y-2 text-xs text-muted-foreground border-t border-border pt-3">
                        <p><strong>Example - Fraud Detection:</strong></p>
                        <p>Same customer (Email 50 + Name 20) orders different products → <strong>70 pts → Flagged ✓</strong></p>
                        <p className="mt-2"><strong>Example - Limit Purchase by SKU:</strong></p>
                        <p>Enable <em>only</em> SKU matching. Same customer re-orders same SKU → <strong>70 pts (SKU 50 + Name 20) → Flagged ✓</strong></p>
                        <p className="italic mt-2">💡 Tip: Name is always checked as supporting evidence. Combine Email + SKU for strongest fraud detection.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notifications" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-section-header">Enable Notifications</CardTitle>
                    <CardDescription>
                      Get notified when duplicate orders are detected.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="enableNotifications"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel>Notification Alerts</FormLabel>
                            <FormDescription>
                              Receive alerts via email or Slack
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-enable-notifications"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-section-header">Notification Channels</CardTitle>
                    <CardDescription>
                      Configure where notifications should be sent.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="notificationEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="admin@example.com"
                              {...field}
                              value={field.value || ""}
                              data-testid="input-notification-email"
                            />
                          </FormControl>
                          <FormDescription>
                            Email address to receive duplicate order alerts
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="slackWebhookUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Slack Webhook URL</FormLabel>
                          <FormControl>
                            <Input
                              type="url"
                              placeholder="https://hooks.slack.com/services/..."
                              {...field}
                              value={field.value || ""}
                              data-testid="input-slack-webhook"
                            />
                          </FormControl>
                          <FormDescription>
                            Slack webhook URL for notifications
                          </FormDescription>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notificationThreshold"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            Confidence Threshold: {field.value}%
                            <InfoTooltip
                              content="Notification threshold - only get alerted for high-confidence matches. Note: Orders are flagged at 70+ points, but you can set a higher threshold for notifications to reduce noise."
                              side="bottom"
                            />
                          </FormLabel>
                          <FormControl>
                            <Slider
                              min={50}
                              max={100}
                              step={5}
                              value={[field.value || 80]}
                              onValueChange={([value]) => field.onChange(value)}
                              data-testid="slider-notification-threshold"
                            />
                          </FormControl>
                          <FormDescription>
                            Only send notifications for duplicates with {field.value}% or higher confidence
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <WebhookStatus />
              </TabsContent>
            </Tabs>

            <div className="flex justify-end mt-6">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save-settings"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </form>
        </Form>
      </main>
    </div>
  );
}

interface WebhookStatusResponse {
  registered: boolean;
  webhooks: {
    ordersCreate: any;
    ordersUpdated: any;
  };
}

function WebhookStatus() {
  const { data: status, isLoading, error } = useQuery<WebhookStatusResponse>({
    queryKey: ['/api/webhooks/status'],
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-section-header text-destructive">Webhook Status Error</CardTitle>
          <CardDescription>Failed to check webhook status</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const isRegistered = status?.registered;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-section-header">Webhook Status</CardTitle>
        <CardDescription>
          Status of Shopify webhooks for order updates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <div className={`h-3 w-3 rounded-full ${isRegistered ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-medium">
            {isRegistered ? 'Active & Registered' : 'Not Registered'}
          </span>
        </div>
        {!isRegistered && (
          <p className="text-sm text-muted-foreground mt-2">
            Webhooks are not currently registered. Try reinstalling the app to fix this.
          </p>
        )}
        {status?.webhooks && (
          <div className="mt-4 space-y-2">
            <div className="text-sm">
              <span className="font-medium">Orders Create:</span> {status.webhooks.ordersCreate ? '✅' : '❌'}
            </div>
            <div className="text-sm">
              <span className="font-medium">Orders Updated:</span> {status.webhooks.ordersUpdated ? '✅' : '❌'}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
