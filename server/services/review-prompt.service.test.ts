import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "@shared/schema";

const {
  getSubscription,
  initializeSubscription,
  getReviewPromptActivationSummary,
  updateSubscription,
} = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  initializeSubscription: vi.fn(),
  getReviewPromptActivationSummary: vi.fn(),
  updateSubscription: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getSubscription,
    initializeSubscription,
    getReviewPromptActivationSummary,
    updateSubscription,
  },
}));

import {
  reviewPromptService,
  REVIEW_PROMPT_COOLDOWN_DAYS,
  REVIEW_PROMPT_MIN_PROCESSED_ORDERS,
} from "./review-prompt.service";

function createSubscription(
  overrides: Partial<Subscription> = {}
): Subscription {
  const now = new Date("2026-04-03T12:00:00.000Z");
  const periodEnd = new Date("2026-05-03T12:00:00.000Z");

  return {
    id: "sub-1",
    shopifyShopDomain: "test-shop.myshopify.com",
    tier: "free",
    status: "active",
    monthlyOrderCount: 0,
    orderLimit: 30,
    currentBillingPeriodStart: now,
    currentBillingPeriodEnd: periodEnd,
    shopifyChargeId: null,
    quotaExceededNotifiedAt: null,
    reviewPromptDismissedAt: null,
    reviewPromptDeferredUntil: null,
    reviewPromptResponse: null,
    reviewPromptRespondedAt: null,
    reviewPromptCtaClickedAt: null,
    createdAt: new Date("2026-03-20T12:00:00.000Z"),
    updatedAt: now,
    ...overrides,
  };
}

describe("ReviewPromptService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the prompt when the shop is younger than three days", async () => {
    getSubscription.mockResolvedValue(
      createSubscription({
        createdAt: new Date("2026-04-02T12:00:00.000Z"),
      })
    );

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(false);
    expect(getReviewPromptActivationSummary).not.toHaveBeenCalled();
  });

  it("hides the prompt when activation evidence is missing", async () => {
    getSubscription.mockResolvedValue(createSubscription());
    getReviewPromptActivationSummary.mockResolvedValue({
      totalOrders: REVIEW_PROMPT_MIN_PROCESSED_ORDERS - 1,
      hasDetectedDuplicate: false,
    });

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(false);
  });

  it("shows the prompt when duplicate evidence exists", async () => {
    getSubscription.mockResolvedValue(createSubscription());
    getReviewPromptActivationSummary.mockResolvedValue({
      totalOrders: 2,
      hasDetectedDuplicate: true,
    });

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(true);
  });

  it("shows the prompt when the processed-order threshold is met", async () => {
    getSubscription.mockResolvedValue(createSubscription());
    getReviewPromptActivationSummary.mockResolvedValue({
      totalOrders: REVIEW_PROMPT_MIN_PROCESSED_ORDERS,
      hasDetectedDuplicate: false,
    });

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(true);
  });

  it("hides the prompt after permanent dismissal", async () => {
    getSubscription.mockResolvedValue(
      createSubscription({
        reviewPromptDismissedAt: new Date("2026-04-01T12:00:00.000Z"),
      })
    );

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(false);
    expect(getReviewPromptActivationSummary).not.toHaveBeenCalled();
  });

  it("hides the prompt during the cooldown window", async () => {
    getSubscription.mockResolvedValue(
      createSubscription({
        reviewPromptDeferredUntil: new Date("2026-04-10T12:00:00.000Z"),
      })
    );

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com"
    );

    expect(prompt.showPrompt).toBe(false);
    expect(prompt.cooldownEndsAt).toBe("2026-04-10T12:00:00.000Z");
  });

  it("force shows the prompt when the development override bypasses eligibility", async () => {
    getSubscription.mockResolvedValue(
      createSubscription({
        createdAt: new Date("2026-04-02T12:00:00.000Z"),
      })
    );

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com",
      { forceShow: true }
    );

    expect(prompt.showPrompt).toBe(true);
    expect(getReviewPromptActivationSummary).not.toHaveBeenCalled();
  });

  it("force shows the prompt even if the shop previously deferred it", async () => {
    getSubscription.mockResolvedValue(
      createSubscription({
        reviewPromptDeferredUntil: new Date("2026-04-10T12:00:00.000Z"),
      })
    );

    const prompt = await reviewPromptService.getPromptState(
      "test-shop.myshopify.com",
      { forceShow: true }
    );

    expect(prompt.showPrompt).toBe(true);
  });

  it("records cooldown deferrals for fourteen days", async () => {
    getSubscription.mockResolvedValue(createSubscription());
    updateSubscription.mockImplementation(
      async (_shopDomain: string, updates: Partial<Subscription>) =>
        createSubscription({
          reviewPromptDeferredUntil: updates.reviewPromptDeferredUntil,
        })
    );

    const updatedSubscription = await reviewPromptService.defer(
      "test-shop.myshopify.com"
    );

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const deferredUntil = new Date(updatedSubscription.reviewPromptDeferredUntil!);
    const createdAt = new Date("2026-04-03T12:00:00.000Z");
    const diffInDays = Math.round(
      (deferredUntil.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );

    expect(diffInDays).toBe(REVIEW_PROMPT_COOLDOWN_DAYS);
  });

  it("records permanent dismissal state", async () => {
    getSubscription.mockResolvedValue(createSubscription());
    updateSubscription.mockImplementation(
      async (_shopDomain: string, updates: Partial<Subscription>) =>
        createSubscription({
          reviewPromptDismissedAt: updates.reviewPromptDismissedAt ?? null,
          reviewPromptResponse:
            (updates.reviewPromptResponse as Subscription["reviewPromptResponse"]) ??
            null,
          reviewPromptRespondedAt: updates.reviewPromptRespondedAt ?? null,
        })
    );

    const updatedSubscription = await reviewPromptService.dismiss(
      "test-shop.myshopify.com"
    );

    expect(updatedSubscription.reviewPromptDismissedAt).not.toBeNull();
  });
});
