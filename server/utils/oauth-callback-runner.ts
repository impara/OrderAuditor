import type { Session } from "@shopify/shopify-api";
import type { Response } from "express";
import { handleOAuthCallbackFailure } from "./oauth-callback-recovery";
import type { OAuthRecoveryRegistry } from "./oauth-recovery";

type OAuthCallbackResult = {
  session: Session;
};

type RecoveryLogger = {
  warn(message: string, context: Record<string, string>): void;
  error(message: string, context: Record<string, string>): void;
  info(message: string, context: Record<string, string>): void;
};

export async function runOAuthCallback<T extends OAuthCallbackResult>({
  execute,
  shop,
  response,
  registry,
  logger,
  sanitizeShop,
}: {
  execute: () => Promise<T>;
  shop: unknown;
  response: Response;
  registry: OAuthRecoveryRegistry;
  logger: RecoveryLogger;
  sanitizeShop: (shop: string) => string | null;
}): Promise<T | undefined> {
  try {
    const callback = await execute();
    if (registry.clear(callback.session.shop)) {
      logger.info("[AuthCallback] oauth_cookie_recovered", {
        shop: callback.session.shop.toLowerCase(),
        action: "oauth_completed",
      });
    }
    return callback;
  } catch (error) {
    if (response.headersSent) {
      throw error;
    }

    const handled = handleOAuthCallbackFailure({
      error,
      shop,
      response,
      registry,
      logger,
      sanitizeShop,
    });
    if (handled) {
      return undefined;
    }
    throw error;
  }
}
