import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Flag, Menu } from "lucide-react";
import { Link, useLocation } from "wouter";

export function Header() {
    const [location] = useLocation();
    const search = window.location.search;

    const NavLinks = () => (
        <>
            <Button variant={location === "/" ? "secondary" : "ghost"} asChild data-testid="link-dashboard" className="justify-start">
                <a href={`/${search}`} className="text-sm font-medium">Dashboard</a>
            </Button>
            <Button variant={location === "/settings" ? "secondary" : "ghost"} asChild data-testid="link-settings" className="justify-start">
                <a href={`/settings${search}`} className="text-sm font-medium">Settings</a>
            </Button>
            <Button variant={location === "/subscription" ? "secondary" : "ghost"} asChild data-testid="link-subscription" className="justify-start">
                <a href={`/subscription${search}`} className="text-sm font-medium">Subscription</a>
            </Button>
        </>
    );

    return (
        <header className="border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-20">
            <div className="container mx-auto px-4 sm:px-6 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-1.5 rounded-md">
                            <Flag className="h-5 w-5 text-primary" />
                        </div>
                        <h1 className="text-lg font-bold tracking-tight">Order Auditor</h1>
                    </div>

                    {/* Desktop Nav */}
                    <nav className="hidden md:flex gap-2">
                        <NavLinks />
                    </nav>

                    {/* Mobile Nav */}
                    <div className="md:hidden">
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <Menu className="h-5 w-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right">
                                <div className="flex flex-col gap-4 mt-8">
                                    <NavLinks />
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </div>
        </header>
    );
}
