import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Settings from "@/pages/settings";
import Subscription from "@/pages/subscription";
import Support from "@/pages/support";
import WebhookOps from "@/pages/webhook-ops";
import InternalAdmin from "@/pages/internal-admin";
import NotFound from "@/pages/not-found";
import { AppBridgeProvider } from "@/components/AppBridgeProvider";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/settings" component={Settings} />
      <Route path="/subscription" component={Subscription} />
      <Route path="/support" component={Support} />
      <Route path="/webhook-ops" component={WebhookOps} />
      <Route path="/internal-admin" component={InternalAdmin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppBridgeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AppBridgeProvider>
    </QueryClientProvider>
  );
}

export default App;
