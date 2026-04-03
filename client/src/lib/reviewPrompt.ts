export const REVIEW_PROMPT_STORAGE_KEY = "duplicateGuard_reviewPromptStep";
export const REVIEW_PROMPT_VERSION = "v1";
export const REVIEW_PROMPT_REVIEW_URL =
  "https://apps.shopify.com/duplicate-guard#modal-show=ReviewListingModal";

export type ReviewPromptStep = -1 | 0 | 1;
export type ReviewPromptResponse = "positive" | "negative" | "dismissed" | null;

export function parseReviewPromptStep(
  value: string | null | undefined
): ReviewPromptStep | null {
  if (value === "-1") {
    return -1;
  }

  if (value === "0") {
    return 0;
  }

  if (value === "1") {
    return 1;
  }

  return null;
}

export function getDefaultReviewPromptStep(
  response: ReviewPromptResponse
): ReviewPromptStep {
  if (response === "positive") {
    return 1;
  }

  if (response === "negative") {
    return -1;
  }

  return 0;
}

export function buildReviewPromptSupportPath(
  currentSearch: string,
  basePath = "/support",
  sentiment?: "negative"
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("source", "review_prompt");
  params.set("promptVersion", REVIEW_PROMPT_VERSION);

  if (sentiment) {
    params.set("sentiment", sentiment);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
