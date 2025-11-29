import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "duplicateGuard_welcomeDismissed";

export function WelcomeBanner() {
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    // Check if banner was previously dismissed
    const dismissed = localStorage.getItem(STORAGE_KEY) === "true";
    setIsDismissed(dismissed);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  };

  if (isDismissed) {
    return null;
  }

  return (
    <Card className="mb-6 border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground mb-1">
              Welcome to Duplicate Guard!
            </p>
            <p className="text-sm text-muted-foreground">
              Configure your detection rules below. Tap or hover over the{" "}
              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-muted-foreground text-xs mx-1">
                i
              </span>{" "}
              icons for help.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className={cn(
              "shrink-0 h-8 w-8 p-0",
              "sm:h-8 sm:w-8",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            )}
            aria-label="Dismiss welcome banner"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

