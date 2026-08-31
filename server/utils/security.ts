import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

const DEFAULT_APP_URL = "http://localhost:5000";
const DEFAULT_RETURN_PATH = "/subscription?upgrade=success";
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const SLACK_WEBHOOK_PATH_PATTERN = /^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

function configuredAppOrigin(appUrl: string): URL {
  try {
    return new URL(appUrl);
  } catch {
    logger.error("[Security] APP_URL is invalid; using the local safe fallback origin");
    return new URL(DEFAULT_APP_URL);
  }
}

export function validateReturnUrl(
  returnUrl: string,
  appUrl = process.env.APP_URL || DEFAULT_APP_URL
): string {
  const appOrigin = configuredAppOrigin(appUrl);
  const fallback = new URL(DEFAULT_RETURN_PATH, appOrigin).toString();

  if (typeof returnUrl !== "string" || returnUrl.startsWith("//")) {
    logger.warn("[Security] Rejected an invalid billing return URL");
    return fallback;
  }

  try {
    const candidate = new URL(returnUrl, appOrigin);
    if (
      candidate.origin !== appOrigin.origin ||
      !["http:", "https:"].includes(candidate.protocol)
    ) {
      logger.warn("[Security] Rejected an off-origin billing return URL");
      return fallback;
    }

    return candidate.toString();
  } catch {
    logger.warn("[Security] Rejected a malformed billing return URL");
    return fallback;
  }
}

export function isAllowedSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "hooks.slack.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      SLACK_WEBHOOK_PATH_PATTERN.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function buildFrameAncestorsCsp(shopValue: unknown): string {
  const shop =
    typeof shopValue === "string" && SHOP_DOMAIN_PATTERN.test(shopValue)
      ? shopValue.toLowerCase()
      : null;
  const ancestors = [
    ...(shop ? [`https://${shop}`] : []),
    "https://admin.shopify.com",
  ];
  return `frame-ancestors ${ancestors.join(" ")};`;
}

export function sessionTokenVerificationError(): Error {
  return new Error("Failed to parse session token");
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function requireInternalAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const configuredToken =
    process.env.INTERNAL_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN;

  if (!configuredToken && process.env.NODE_ENV === "production") {
    logger.error("[InternalAdmin] Missing INTERNAL_ADMIN_TOKEN in production");
    return res.status(503).json({ error: "Internal admin is not configured" });
  }

  const expectedToken = configuredToken || "dev-admin-token";
  const providedToken = req.get("X-Admin-Token") || "";
  if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
    return res.status(401).json({ error: "Invalid admin token" });
  }

  next();
}
