import { useState } from "react";
import { Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
    content: string;
    side?: "top" | "right" | "bottom" | "left";
    className?: string;
}

export function InfoTooltip({
    content,
    side = "top",
    className,
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);

    return (
        <Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={(e) => {
                        // Toggle tooltip on click/tap (essential for mobile)
                        // Don't prevent default to allow hover to still work on desktop
                        setOpen((prev) => !prev);
                    }}
                    onPointerDown={(e) => {
                        // Also handle pointer events for better mobile support
                        if (e.pointerType === "touch") {
                            setOpen((prev) => !prev);
                        }
                    }}
                    className={cn(
                        "inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                        "text-muted-foreground hover:text-foreground transition-colors",
                        "h-5 w-5 sm:h-5 sm:w-5", // Consistent sizing for better touch targets
                        "min-w-[20px] min-h-[20px]", // Ensure minimum touch target
                        "touch-manipulation", // Better touch handling on mobile
                        className
                    )}
                    aria-label="More information"
                    aria-expanded={open}
                >
                    <Info className="h-full w-full" />
                </button>
            </TooltipTrigger>
            <TooltipContent
                side={side}
                className="max-w-xs text-sm z-50"
                sideOffset={8}
            >
                <p>{content}</p>
            </TooltipContent>
        </Tooltip>
    );
}

