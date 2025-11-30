import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Provider, useAppBridge } from "@shopify/app-bridge-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { setAppBridge } from "@/lib/queryClient";

function AppBridgeInitializer({ children }: { children: React.ReactNode }) {
    const app = useAppBridge();

    useEffect(() => {
        if (app) {
            setAppBridge(app);
            console.log("App Bridge initialized successfully");
        }
    }, [app]);

    return <>{children}</>;
}

export function AppBridgeProvider({ children }: { children: React.ReactNode }) {
    const [location] = useLocation();
    const [appBridgeConfig, setAppBridgeConfig] = useState<{
        apiKey: string;
        host: string;
        forceRedirect: boolean;
    } | null>(null);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const host = urlParams.get("host");
        const shop = urlParams.get("shop");

        // Try to get API key from environment variable first (compile-time)
        // Fall back to reading from meta tag (runtime injection)
        const apiKey = import.meta.env.VITE_SHOPIFY_API_KEY ||
            document.querySelector('meta[name="shopify-api-key"]')?.getAttribute('content') ||
            '';

        console.log("[AppBridge] Initializing with:", {
            host: host ? "present" : "missing",
            shop: shop || "missing",
            apiKey: apiKey ? "present" : "missing",
            apiKeySource: import.meta.env.VITE_SHOPIFY_API_KEY ? "env" : "meta",
            isInIframe: window !== window.parent,
            location: window.location.href
        });

        if (host && apiKey) {
            setAppBridgeConfig({
                apiKey,
                host,
                forceRedirect: true,
            });
        }
    }, []);

    if (!appBridgeConfig) {
        // If running locally without host param (e.g. direct browser access), 
        // we might want to show a message or just render children for dev mode if configured
        if (import.meta.env.DEV && !window.location.search.includes("host")) {
            return <>{children}</>;
        }

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-amber-600">
                            <AlertCircle className="h-5 w-5" />
                            Missing Shopify Context
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Alert variant="destructive">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>
                                Please launch this app from the Shopify Admin.
                            </AlertDescription>
                        </Alert>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <Provider config={appBridgeConfig}>
            <AppBridgeInitializer>
                {children}
            </AppBridgeInitializer>
        </Provider>
    );
}
