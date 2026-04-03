import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareHeart, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import {
  buildReviewPromptSupportPath,
  getDefaultReviewPromptStep,
  parseReviewPromptStep,
  REVIEW_PROMPT_REVIEW_URL,
  REVIEW_PROMPT_STORAGE_KEY,
  type ReviewPromptResponse,
  type ReviewPromptStep,
} from "@/lib/reviewPrompt";
import { useLocation } from "wouter";

type ReviewPromptApiResponse = {
  showPrompt: boolean;
  response: ReviewPromptResponse;
  cooldownEndsAt: string | null;
  supportUrl: string;
  promptVersion: string;
};

type ReviewPromptIntent =
  | { intent: "dismiss" }
  | { intent: "defer" }
  | { intent: "cta-click" }
  | { intent: "select-branch"; branch: "positive" | "negative" };

export function ReviewPromptBanner() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ReviewPromptStep>(0);
  const [previewHidden, setPreviewHidden] = useState(false);
  const isPreviewMode =
    new URLSearchParams(window.location.search).get("testReviewPrompt") ===
    "true";
  const reviewPromptQueryKey = [`/api/review-prompt${window.location.search}`];

  const { data } = useQuery<ReviewPromptApiResponse>({
    queryKey: reviewPromptQueryKey,
  });

  useEffect(() => {
    if (!data?.showPrompt) {
      sessionStorage.removeItem(REVIEW_PROMPT_STORAGE_KEY);
      setStep(0);
      setPreviewHidden(false);
      return;
    }

    if (isPreviewMode) {
      sessionStorage.removeItem(REVIEW_PROMPT_STORAGE_KEY);
      setStep(0);
      setPreviewHidden(false);
      return;
    }

    const storedStep = parseReviewPromptStep(
      sessionStorage.getItem(REVIEW_PROMPT_STORAGE_KEY)
    );

    setStep(storedStep ?? getDefaultReviewPromptStep(data.response));
    setPreviewHidden(false);
  }, [data]);

  const reviewPromptMutation = useMutation({
    mutationFn: async (payload: ReviewPromptIntent) => {
      const response = await apiRequest("POST", "/api/review-prompt", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewPromptQueryKey });
    },
  });

  const persistStep = (nextStep: ReviewPromptStep) => {
    setStep(nextStep);
    sessionStorage.setItem(REVIEW_PROMPT_STORAGE_KEY, String(nextStep));
  };

  const clearStep = () => {
    setStep(0);
    sessionStorage.removeItem(REVIEW_PROMPT_STORAGE_KEY);
  };

  const handleBranchSelection = async (branch: "positive" | "negative") => {
    if (!isPreviewMode) {
      await reviewPromptMutation.mutateAsync({
        intent: "select-branch",
        branch,
      });
    }

    persistStep(branch === "positive" ? 1 : -1);
  };

  const handleDismiss = async () => {
    if (!isPreviewMode) {
      await reviewPromptMutation.mutateAsync({ intent: "dismiss" });
    }
    clearStep();
    setPreviewHidden(true);
  };

  const handleMaybeLater = async () => {
    if (!isPreviewMode) {
      await reviewPromptMutation.mutateAsync({ intent: "defer" });
    }
    clearStep();
    setPreviewHidden(true);
  };

  const handleReviewClick = async () => {
    window.open(REVIEW_PROMPT_REVIEW_URL, "_blank", "noopener,noreferrer");
    if (!isPreviewMode) {
      await reviewPromptMutation.mutateAsync({ intent: "cta-click" });
    }
    clearStep();
    setPreviewHidden(true);
  };

  const handleShareFeedback = async () => {
    if (!isPreviewMode) {
      await reviewPromptMutation.mutateAsync({ intent: "dismiss" });
    }
    clearStep();
    setPreviewHidden(true);
    const supportPath = data?.supportUrl || "/support";
    setLocation(
      buildReviewPromptSupportPath(
        window.location.search,
        supportPath,
        "negative"
      )
    );
  };

  if (!data?.showPrompt || previewHidden) {
    return null;
  }

  return (
    <Card className="mb-6 border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-3">
            {step === 0 && (
              <>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Enjoying Duplicate Guard so far?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    If it&apos;s helping you catch duplicates faster, we&apos;d
                    love a quick review.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={() => handleBranchSelection("positive")}
                    disabled={reviewPromptMutation.isPending}
                  >
                    <ThumbsUp className="mr-2 h-4 w-4" />
                    Yes, it&apos;s helpful
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleBranchSelection("negative")}
                    disabled={reviewPromptMutation.isPending}
                  >
                    <ThumbsDown className="mr-2 h-4 w-4" />
                    Not quite yet
                  </Button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Thanks for using Duplicate Guard.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    A quick App Store review helps other merchants discover the
                    app.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={handleReviewClick}
                    disabled={reviewPromptMutation.isPending}
                  >
                    <MessageSquareHeart className="mr-2 h-4 w-4" />
                    Leave a review
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleMaybeLater}
                    disabled={reviewPromptMutation.isPending}
                  >
                    Maybe later
                  </Button>
                </div>
              </>
            )}

            {step === -1 && (
              <>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Thanks for the honesty.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Share what&apos;s missing and we&apos;ll use it to improve
                    Duplicate Guard.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={handleShareFeedback}
                    disabled={reviewPromptMutation.isPending}
                  >
                    Share feedback
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDismiss}
                    disabled={reviewPromptMutation.isPending}
                  >
                    Dismiss
                  </Button>
                </div>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0"
            onClick={handleDismiss}
            disabled={reviewPromptMutation.isPending}
            aria-label="Dismiss review prompt"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
