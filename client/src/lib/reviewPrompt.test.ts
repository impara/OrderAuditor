import { describe, expect, it } from "vitest";
import {
  buildReviewPromptSupportPath,
  getDefaultReviewPromptStep,
  parseReviewPromptStep,
  REVIEW_PROMPT_REVIEW_URL,
  REVIEW_PROMPT_VERSION,
} from "./reviewPrompt";

describe("reviewPrompt helpers", () => {
  it("parses stored session steps safely", () => {
    expect(parseReviewPromptStep("1")).toBe(1);
    expect(parseReviewPromptStep("0")).toBe(0);
    expect(parseReviewPromptStep("-1")).toBe(-1);
    expect(parseReviewPromptStep("9")).toBeNull();
  });

  it("derives the correct fallback step from the server response", () => {
    expect(getDefaultReviewPromptStep("positive")).toBe(1);
    expect(getDefaultReviewPromptStep("negative")).toBe(-1);
    expect(getDefaultReviewPromptStep("dismissed")).toBe(0);
    expect(getDefaultReviewPromptStep(null)).toBe(0);
  });

  it("builds a support URL that preserves embedded app params", () => {
    const path = buildReviewPromptSupportPath(
      "?shop=test-shop.myshopify.com&host=abc123",
      "/support",
      "negative"
    );

    expect(path).toBe(
      `/support?shop=test-shop.myshopify.com&host=abc123&source=review_prompt&promptVersion=${REVIEW_PROMPT_VERSION}&sentiment=negative`
    );
  });

  it("uses the fixed external Shopify review URL", () => {
    expect(REVIEW_PROMPT_REVIEW_URL).toBe(
      "https://apps.shopify.com/duplicate-guard#modal-show=ReviewListingModal"
    );
  });
});
