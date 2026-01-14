import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { Send, MessageSquare, Lightbulb, Bug, CreditCard, CheckCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type RequestType = "support" | "feature" | "bug" | "billing";
type Priority = "low" | "normal" | "high" | "urgent";

interface SupportFormData {
    requestType: RequestType;
    subject: string;
    description: string;
    priority: Priority;
}

const requestTypeConfig: Record<RequestType, { label: string; icon: typeof MessageSquare; description: string }> = {
    support: {
        label: "Support Request",
        icon: MessageSquare,
        description: "Get help with using Duplicate Guard",
    },
    feature: {
        label: "Feature Request",
        icon: Lightbulb,
        description: "Suggest a new feature or improvement",
    },
    bug: {
        label: "Bug Report",
        icon: Bug,
        description: "Report an issue or unexpected behavior",
    },
    billing: {
        label: "Billing Question",
        icon: CreditCard,
        description: "Questions about your subscription or billing",
    },
};

export default function Support() {
    const { toast } = useToast();
    const [submitted, setSubmitted] = useState(false);
    const [formData, setFormData] = useState<SupportFormData>({
        requestType: "support",
        subject: "",
        description: "",
        priority: "normal",
    });

    // Get subscription info for context
    const { data: subscription } = useQuery<any>({
        queryKey: ["/api/subscription"],
    });

    const submitMutation = useMutation({
        mutationFn: async (data: SupportFormData) => {
            return await apiRequest("POST", "/api/support", data);
        },
        onSuccess: () => {
            setSubmitted(true);
            toast({
                title: "Request submitted",
                description: "We've received your message and will get back to you soon.",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Failed to submit",
                description: error.message || "Please try again later.",
                variant: "destructive",
            });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.subject.trim() || !formData.description.trim()) {
            toast({
                title: "Missing fields",
                description: "Please fill in all required fields.",
                variant: "destructive",
            });
            return;
        }
        submitMutation.mutate(formData);
    };

    const resetForm = () => {
        setFormData({
            requestType: "support",
            subject: "",
            description: "",
            priority: "normal",
        });
        setSubmitted(false);
    };

    if (submitted) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
                    <Card className="text-center py-12">
                        <CardContent>
                            <div className="flex justify-center mb-6">
                                <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                    <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                                </div>
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Request Submitted!</h2>
                            <p className="text-muted-foreground mb-6">
                                Thank you for reaching out. We typically respond within 24-48 hours.
                            </p>
                            <Button onClick={resetForm} variant="outline">
                                Submit Another Request
                            </Button>
                        </CardContent>
                    </Card>
                </main>
            </div>
        );
    }

    const showPriority = formData.requestType === "support" || formData.requestType === "bug";
    const currentConfig = requestTypeConfig[formData.requestType];
    const IconComponent = currentConfig.icon;

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
                <div className="mb-6">
                    <h2 className="text-page-title mb-2">Support & Feedback</h2>
                    <p className="text-sm text-muted-foreground">
                        Have a question, idea, or issue? We'd love to hear from you.
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle className="text-section-header">Request Type</CardTitle>
                            <CardDescription>What would you like to contact us about?</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-3">
                                {(Object.keys(requestTypeConfig) as RequestType[]).map((type) => {
                                    const config = requestTypeConfig[type];
                                    const Icon = config.icon;
                                    const isSelected = formData.requestType === type;

                                    return (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, requestType: type })}
                                            className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-muted hover:border-muted-foreground/30"
                                                }`}
                                        >
                                            <Icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                                            <span className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>
                                                {config.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="mb-6">
                        <CardHeader>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <IconComponent className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-section-header">{currentConfig.label}</CardTitle>
                                    <CardDescription>{currentConfig.description}</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="subject">Subject *</Label>
                                <Input
                                    id="subject"
                                    placeholder="Brief summary of your request"
                                    value={formData.subject}
                                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Description *</Label>
                                <Textarea
                                    id="description"
                                    placeholder={
                                        formData.requestType === "bug"
                                            ? "Please describe what happened, what you expected, and steps to reproduce..."
                                            : formData.requestType === "feature"
                                                ? "Describe your idea and how it would help your workflow..."
                                                : "How can we help you today?"
                                    }
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={6}
                                    required
                                />
                            </div>

                            {showPriority && (
                                <div className="space-y-2">
                                    <Label htmlFor="priority">Priority</Label>
                                    <Select
                                        value={formData.priority}
                                        onValueChange={(value: Priority) => setFormData({ ...formData, priority: value })}
                                    >
                                        <SelectTrigger id="priority">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="low">Low - No rush</SelectItem>
                                            <SelectItem value="normal">Normal</SelectItem>
                                            <SelectItem value="high">High - Important</SelectItem>
                                            <SelectItem value="urgent">Urgent - Blocking work</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={submitMutation.isPending} size="lg">
                            <Send className="h-4 w-4 mr-2" />
                            {submitMutation.isPending ? "Sending..." : "Submit Request"}
                        </Button>
                    </div>
                </form>

                <div className="mt-8 p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground text-center">
                        Your shop information ({subscription?.shopifyShopDomain || "unknown"}) and subscription tier ({subscription?.tier || "free"})
                        will be automatically included with your request.
                    </p>
                </div>
            </main>
        </div>
    );
}
