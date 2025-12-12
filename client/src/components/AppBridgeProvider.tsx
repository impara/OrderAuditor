import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function AppBridgeProvider({ children }: { children: React.ReactNode }) {
    const [isReady, setIsReady] = useState(false);
    const [reinstallUrl, setReinstallUrl] = useState<string | null>(null);

    useEffect(() => {
        const handleReinstall = (event: Event) => {
            const customEvent = event as CustomEvent;
            if (customEvent.detail && customEvent.detail.installUrl) {
                setReinstallUrl(customEvent.detail.installUrl);
            }
        };

        window.addEventListener("shopify:reinstall_required", handleReinstall);
        return () => window.removeEventListener("shopify:reinstall_required", handleReinstall);
    }, []);

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

    return (
        <>
            {children}
            <AlertDialog open={!!reinstallUrl}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Connection Expired</AlertDialogTitle>
                        <AlertDialogDescription>
                            Your session has expired or the app needs to be reconnected. Please click the button below to restore the connection.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction
                            onClick={() => {
                                if (reinstallUrl) {
                                    window.top!.location.href = reinstallUrl;
                                }
                            }}
                        >
                            Reconnect App
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
