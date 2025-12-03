import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export function AppBridgeProvider({ children }: { children: React.ReactNode }) {
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const host = urlParams.get("host");
        const shop = urlParams.get("shop");

        // In App Bridge v4, the script tag in index.html handles initialization
        // We just need to ensure we have the necessary params for the app to function

        console.log("[AppBridge] Checking context:", {
            host: host ? "present" : "missing",
            shop: shop || "missing",
            isInIframe: window !== window.parent,
        });

        if (host) {
            setIsReady(true);
        } else if (import.meta.env.DEV) {
            // Allow dev mode without host if needed (e.g. direct browser access)
            setIsReady(true);
        }
    }, []);

    if (!isReady) {
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

    return <>{children}</>;
}
