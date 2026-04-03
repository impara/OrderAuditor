import { storage } from "../storage";
import type { Subscription } from "@shared/schema";

export const REVIEW_PROMPT_VERSION = "v1";
export const REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS = 3;
export const REVIEW_PROMPT_COOLDOWN_DAYS = 14;
export const REVIEW_PROMPT_MIN_PROCESSED_ORDERS = 25;
export const REVIEW_PROMPT_SUPPORT_PATH = "/support";

export type ReviewPromptResponse = "positive" | "negative" | "dismissed";

export interface ReviewPromptState {
  showPrompt: boolean;
  response: ReviewPromptResponse | null;
  cooldownEndsAt: string | null;
  supportUrl: string;
  promptVersion: string;
}

export class ReviewPromptService {
  private async getOrInitializeSubscription(
    shopDomain: string
  ): Promise<Subscription> {
    let subscription = await storage.getSubscription(shopDomain);
    if (!subscription) {
      subscription = await storage.initializeSubscription(shopDomain);
    }
    return subscription;
  }

  async getPromptState(
    shopDomain: string,
    options?: { forceShow?: boolean }
  ): Promise<ReviewPromptState> {
    const subscription = await this.getOrInitializeSubscription(shopDomain);
    if (options?.forceShow) {
      return this.toState(subscription, true);
    }

    const now = new Date();

    const minAge = new Date(subscription.createdAt);
    minAge.setDate(minAge.getDate() + REVIEW_PROMPT_MIN_ACCOUNT_AGE_DAYS);

    if (now < minAge) {
      return this.toState(subscription, false);
    }

    if (subscription.reviewPromptDismissedAt) {
      return this.toState(subscription, false);
    }

    if (
      subscription.reviewPromptDeferredUntil &&
      new Date(subscription.reviewPromptDeferredUntil) > now
    ) {
      return this.toState(subscription, false);
    }

    const activation = await storage.getReviewPromptActivationSummary(shopDomain);
    const hasActivationEvidence =
      activation.hasDetectedDuplicate ||
      activation.totalOrders >= REVIEW_PROMPT_MIN_PROCESSED_ORDERS;

    return this.toState(subscription, hasActivationEvidence);
  }

  async selectBranch(
    shopDomain: string,
    response: Extract<ReviewPromptResponse, "positive" | "negative">
  ): Promise<Subscription> {
    await this.getOrInitializeSubscription(shopDomain);
    return storage.updateSubscription(shopDomain, {
      reviewPromptResponse: response,
      reviewPromptRespondedAt: new Date(),
    });
  }

  async defer(shopDomain: string): Promise<Subscription> {
    await this.getOrInitializeSubscription(shopDomain);
    const deferredUntil = new Date();
    deferredUntil.setDate(
      deferredUntil.getDate() + REVIEW_PROMPT_COOLDOWN_DAYS
    );

    return storage.updateSubscription(shopDomain, {
      reviewPromptDeferredUntil: deferredUntil,
    });
  }

  async dismiss(
    shopDomain: string,
    response?: ReviewPromptResponse
  ): Promise<Subscription> {
    const subscription = await this.getOrInitializeSubscription(shopDomain);
    const now = new Date();

    return storage.updateSubscription(shopDomain, {
      reviewPromptDismissedAt: now,
      reviewPromptDeferredUntil: null,
      reviewPromptResponse:
        response || subscription.reviewPromptResponse || "dismissed",
      reviewPromptRespondedAt: subscription.reviewPromptRespondedAt || now,
    });
  }

  async recordCtaClick(shopDomain: string): Promise<Subscription> {
    const subscription = await this.getOrInitializeSubscription(shopDomain);
    const now = new Date();

    return storage.updateSubscription(shopDomain, {
      reviewPromptCtaClickedAt: now,
      reviewPromptDismissedAt: now,
      reviewPromptDeferredUntil: null,
      reviewPromptResponse: subscription.reviewPromptResponse || "positive",
      reviewPromptRespondedAt: subscription.reviewPromptRespondedAt || now,
    });
  }

  private toState(
    subscription: Subscription,
    showPrompt: boolean
  ): ReviewPromptState {
    return {
      showPrompt,
      response: subscription.reviewPromptResponse || null,
      cooldownEndsAt: subscription.reviewPromptDeferredUntil
        ? new Date(subscription.reviewPromptDeferredUntil).toISOString()
        : null,
      supportUrl: REVIEW_PROMPT_SUPPORT_PATH,
      promptVersion: REVIEW_PROMPT_VERSION,
    };
  }
}

export const reviewPromptService = new ReviewPromptService();
