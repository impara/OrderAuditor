import { CookieNotFound } from "@shopify/shopify-api";
import type { Response } from "express";
import type { OAuthRecoveryRegistry } from "./oauth-recovery";

// Keep this defensive assertion aligned with the built-in domains accepted by
// Shopify's sanitizeShop utility. The SDK sanitizer remains authoritative at
// the integration boundary; this prevents paths/control characters from being
// introduced before constructing the relative recovery URL.
const SHOP_DOMAIN_PATTERN =
  /^[a-z0-9][a-z0-9_-]*\.(?:myshopify\.com|shopify\.com|myshopify\.io|shop\.dev)\/*$/;

type RecoveryLogger = {
  warn(message: string, context: Record<string, string>): void;
  error(message: string, context: Record<string, string>): void;
};

type SanitizeShop = (shop: string) => string | null;

export function isOAuthCookieNotFound(error: unknown): boolean {
  return error instanceof CookieNotFound;
}

function normalizeShop(shop: string): string {
  if (shop !== shop.trim()) {
    throw new Error("Invalid Shopify shop domain");
  }

  const normalized = shop.toLowerCase();
  if (!SHOP_DOMAIN_PATTERN.test(normalized)) {
    throw new Error("Invalid Shopify shop domain");
  }
  return normalized.replace(/\/+$/, "");
}

export function buildOAuthRestartPath(shop: string): string {
  const normalized = normalizeShop(shop);
  return `/api/auth?shop=${encodeURIComponent(normalized)}`;
}

export function renderOAuthRecoveryPage(shop: string): string {
  const restartPath = buildOAuthRestartPath(shop);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reconnect Duplicate Guard</title>
  </head>
  <body>
    <main>
      <h1>Reconnect Duplicate Guard</h1>
      <p>The Shopify approval took longer than the secure sign-in window. Reconnect Duplicate Guard to finish setup.</p>
      <p>If you see this page again, reopen Duplicate Guard from Shopify Admin and complete authorization promptly.</p>
      <p><a href="${restartPath}">Reconnect Duplicate Guard</a></p>
    </main>
  </body>
</html>`;
}

export function handleOAuthCallbackFailure({
  error,
  shop,
  response,
  registry,
  logger,
  sanitizeShop,
}: {
  error: unknown;
  shop: unknown;
  response: Response;
  registry: OAuthRecoveryRegistry;
  logger: RecoveryLogger;
  sanitizeShop: SanitizeShop;
}): boolean {
  if (!isOAuthCookieNotFound(error)) {
    return false;
  }

  response.set("Cache-Control", "no-store");
  if (typeof shop !== "string") {
    response.status(400).send("Invalid Shopify shop");
    return true;
  }

  const sanitizedShop = sanitizeShop(shop);
  if (!sanitizedShop) {
    response.status(400).send("Invalid Shopify shop");
    return true;
  }

  let normalizedShop: string;
  try {
    normalizedShop = normalizeShop(sanitizedShop);
  } catch {
    response.status(400).send("Invalid Shopify shop");
    return true;
  }

  // The expired callback is not trusted as an authorization event. Its code,
  // HMAC, state, timestamp, and other parameters are discarded. This redirect
  // only selects a sanitized shop for a completely fresh SDK-managed OAuth flow.
  const claim = registry.claimAutomaticRetry(normalizedShop);
  if (claim === "claimed") {
    logger.warn("[AuthCallback] oauth_cookie_missing", {
      shop: normalizedShop,
      action: "automatic_retry",
    });
    response.redirect(303, buildOAuthRestartPath(normalizedShop));
    return true;
  }

  logger.error(
    claim === "capacity_exhausted"
      ? "[AuthCallback] oauth_recovery_capacity_exhausted"
      : "[AuthCallback] oauth_cookie_missing",
    {
      shop: normalizedShop,
      action: "manual_recovery",
    }
  );
  response.type("html").status(409).send(renderOAuthRecoveryPage(normalizedShop));
  return true;
}
