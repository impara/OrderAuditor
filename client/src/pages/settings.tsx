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
import { useToast } from "@/hooks/use-toast";
import { Flag, Bell, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { DetectionSettings, UpdateDetectionSettings } from "@shared/schema";
import { updateDetectionSettingsSchema } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";

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
      matchPhone: false,
      matchAddress: true,
      addressSensitivity: "medium",
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
        addressSensitivity: settings.addressSensitivity,
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
        <header className="border-b border-border bg-background">
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
        <main className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
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

      <main className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
        <div className="mb-6">
          <h2 className="text-page-title mb-2">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure duplicate detection rules and notification preferences.
          </p>
        </div>

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
                          <FormLabel>Hours: {field.value}</FormLabel>
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
                            Orders within the last {field.value} hours will be checked for duplicates.
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
                      Select which customer details to compare when detecting duplicates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="matchEmail"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <FormLabel>Email Address</FormLabel>
                            <FormDescription>
                              Match orders with the same email address
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
                            <FormLabel>Phone Number</FormLabel>
                            <FormDescription>
                              Match orders with the same phone number
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
                            <FormLabel>Shipping Address</FormLabel>
                            <FormDescription>
                              Match orders with similar shipping addresses
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

                    <FormField
                      control={form.control}
                      name="addressSensitivity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address Matching Sensitivity</FormLabel>
                          <Select 
                            onValueChange={field.onChange} 
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-address-sensitivity">
                                <SelectValue placeholder="Select sensitivity" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low - Allow minor differences</SelectItem>
                              <SelectItem value="medium">Medium - Balanced matching</SelectItem>
                              <SelectItem value="high">High - Exact match required</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            How strictly should addresses match to be considered duplicates?
                          </FormDescription>
                        </FormItem>
                      )}
                    />
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
                          <FormLabel>Confidence Threshold: {field.value}%</FormLabel>
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
