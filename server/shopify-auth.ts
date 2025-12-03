import "@shopify/shopify-api/adapters/node";
import {
  shopifyApi,
  ApiVersion,
  BillingInterval,
  DeliveryMethod,
} from "@shopify/shopify-api";
import { PostgresSessionStorage } from "./shopify-session-storage";
import { Request, Response, NextFunction } from "express";
import { logger } from "./utils/logger";
import * as jose from "jose";
import { createSecretKey } from "crypto";
import { shopifyBillingService } from "./services/shopify-billing.service";

// Initialize Shopify API client
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "", // API Secret Key (Client Secret) for OAuth and token validation
  scopes: [
    "read_orders",
    "write_orders",
    "read_customers",
    "read_merchant_managed_fulfillment_orders",
    "write_merchant_managed_fulfillment_orders",
  ],
  hostName: (process.env.APP_URL || "").replace(/https?:\/\//, ""),
  hostScheme: "https",
  apiVersion: ApiVersion.October24,
  isEmbeddedApp: true,
  sessionStorage: new PostgresSessionStorage(),
});

// Register webhook handlers
// Note: GDPR compliance webhooks (customers/data_request, customers/redact, shop/redact)
// are now configured via shopify.app.toml file and will use the unified endpoint
// /api/webhooks/shopify. They should NOT be registered here to avoid conflicts.
shopify.webhooks.addHandlers({
  "orders/create": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/orders/create",
  },
  "orders/updated": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/orders/updated",
  },
  "app/uninstalled": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/app/uninstalled",
  },
  "app_subscriptions/update": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/app_subscriptions/update",
  },
  // GDPR compliance webhooks are configured via shopify.app.toml
  // They use the unified endpoint: /api/webhooks/shopify
  // Do not register them here to avoid conflicts with TOML configuration
});

export { shopify };

export async function auth(req: Request, res: Response) {
  try {
    if (!req.query.shop) {
      res.status(500).send("No shop provided");
      return;
    }

    const shop = shopify.utils.sanitizeShop(req.query.shop as string, true)!;
    logger.info(
      `[Auth] Starting OAuth flow for shop: ${shop}, requesting OFFLINE token (isOnline: false)`
    );
    logger.info(
      `[Auth] App configuration - isEmbeddedApp: ${
        shopify.config.isEmbeddedApp
      }, API Key: ${shopify.config.apiKey?.substring(0, 10)}...`
    );

    // The library handles the redirect to Shopify
    // For offline tokens, isOnline MUST be false
    await shopify.auth.begin({
      shop: shop,
      callbackPath: "/api/auth/callback",
      isOnline: false, // Offline token for background jobs (webhooks) - CRITICAL: must be false
      rawRequest: req,
      rawResponse: res,
    });

    logger.debug(`[Auth] OAuth redirect initiated for shop: ${shop}`);
  } catch (e: any) {
    logger.error(`Failed to begin auth: ${e.message}`);
    logger.error(`[Auth] Error stack: ${e.stack}`);
    res.status(500).send(e.message);
  }
}

export async function authCallback(req: Request, res: Response) {
  try {
    logger.info(`[AuthCallback] Starting OAuth callback`);

    // Log OAuth callback query parameters (excluding sensitive data)
    const queryParams = { ...req.query };
    delete queryParams.code; // Don't log the code
    delete queryParams.hmac; // Don't log the hmac
    logger.debug(
      `[AuthCallback] OAuth callback query params: ${JSON.stringify(
        Object.keys(queryParams)
      )}`
    );

    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;
    const tokenPrefix = session.accessToken?.substring(0, 6) || "N/A";
    const tokenLength = session.accessToken?.length || 0;

    logger.info(
      `[AuthCallback] OAuth callback completed, session ID: ${session.id}, shop: ${session.shop}, isOnline: ${session.isOnline}`
    );
    logger.info(
      `[AuthCallback] Session has accessToken: ${!!session.accessToken}, token prefix: ${tokenPrefix}, token length: ${tokenLength}`
    );

    // Log full session details for debugging
    // Note: Token prefixes are NOT reliable indicators - check response structure instead
    // Online tokens have: expires_in, associated_user_scope, associated_user
    // Offline tokens have: only access_token and scope
    logger.debug(`[AuthCallback] Full session details:`, {
      id: session.id,
      shop: session.shop,
      isOnline: session.isOnline,
      scope: session.scope,
      expires: session.expires?.toISOString(),
      tokenPrefix,
      tokenLength,
      hasOnlineAccessInfo: !!session.onlineAccessInfo,
      onlineAccessInfo: session.onlineAccessInfo
        ? {
            hasAssociatedUser: !!session.onlineAccessInfo.associated_user,
            expiresIn: session.onlineAccessInfo.expires_in,
          }
        : null,
    });

    // Determine actual token type based on response structure (not prefix)
    const isActuallyOnlineToken =
      !!session.onlineAccessInfo?.associated_user || !!session.expires;
    const isActuallyOfflineToken =
      !session.onlineAccessInfo?.associated_user && !session.expires;

    logger.info(
      `[AuthCallback] Token type analysis - Prefix: ${tokenPrefix}, Has expires: ${!!session.expires}, Has associated_user: ${!!session
        .onlineAccessInfo?.associated_user}`
    );
    logger.info(
      `[AuthCallback] Actual token type - Is Online: ${isActuallyOnlineToken}, Is Offline: ${isActuallyOfflineToken}`
    );

    // Validate that we got an offline session as expected
    if (session.isOnline) {
      logger.error(
        `[AuthCallback] WARNING: Received ONLINE session but expected OFFLINE session! This will cause API call failures.`
      );
      logger.error(
        `[AuthCallback] Session details - ID: ${session.id}, Shop: ${session.shop}, Token prefix: ${tokenPrefix}`
      );
    } else {
      // Validate offline token format
      if (session.accessToken) {
        if (tokenPrefix === "shpua_") {
          logger.error(
            `[AuthCallback] CRITICAL: Offline session has USER ACCESS TOKEN (shpua_) instead of OFFLINE TOKEN (shpat_)!`
          );
        } else if (tokenPrefix === "shpat_") {
          logger.info(
            `[AuthCallback] ✅ Valid offline token received (shpat_ prefix)`
          );
        } else {
          logger.warn(
            `[AuthCallback] Unexpected token prefix: ${tokenPrefix}. Expected 'shpat_' for offline tokens.`
          );
        }
      }
    }

    // Manually store the session to ensure it's saved
    logger.info(`[AuthCallback] Manually storing session...`);
    const stored = await shopify.config.sessionStorage!.storeSession(session);
    logger.info(`[AuthCallback] Manual session storage result: ${stored}`);

    // Register webhooks after auth
    // Note: Webhook registration may fail if Protected Customer Data access is not approved
    // This is non-blocking - the app can still function, but duplicate detection will be limited
    try {
      logger.info(
        `[AuthCallback] Attempting to register webhooks for shop: ${session.shop}`
      );
      logger.debug(
        `[AuthCallback] Session access token available: ${!!session.accessToken}, token prefix: ${
          session.accessToken?.substring(0, 6) || "N/A"
        }`
      );

      // Retry webhook registration with exponential backoff
      const maxRetries = 3;
      let lastError: any = null;
      let response: any = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          logger.info(
            `[AuthCallback] Retrying webhook registration (attempt ${
              attempt + 1
            }/${maxRetries + 1}) after ${delayMs}ms delay...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        try {
          response = await shopify.webhooks.register({
            session,
          });
          // If we got a response, break out of retry loop
          break;
        } catch (error: any) {
          lastError = error;
          const errorMessage = error?.message || String(error);
          const lowerMessage = errorMessage.toLowerCase();

          // Check if error is retryable
          const isRetryable =
            lowerMessage.includes("network") ||
            lowerMessage.includes("fetch failed") ||
            lowerMessage.includes("econnrefused") ||
            lowerMessage.includes("etimedout") ||
            lowerMessage.includes("timeout") ||
            lowerMessage.includes("enotfound") ||
            lowerMessage.includes("rate limit") ||
            lowerMessage.includes("too many requests");

          // Don't retry on authentication/authorization errors
          const isNotRetryable =
            lowerMessage.includes("unauthorized") ||
            lowerMessage.includes("forbidden") ||
            lowerMessage.includes("bad request") ||
            lowerMessage.includes("invalid") ||
            lowerMessage.includes("permission denied");

          if (isNotRetryable || (!isRetryable && attempt < maxRetries)) {
            if (isNotRetryable) {
              logger.info(
                `[AuthCallback] Error is not retryable, stopping retries: ${errorMessage}`
              );
            }
            // If not retryable or last attempt, break
            if (isNotRetryable || attempt === maxRetries) {
              break;
            }
          }

          if (attempt < maxRetries) {
            logger.warn(
              `[AuthCallback] Webhook registration failed (attempt ${
                attempt + 1
              }/${maxRetries + 1}): ${errorMessage}`
            );
          }
        }
      }

      // If all retries failed, throw the last error
      if (!response && lastError) {
        throw lastError;
      }

      // If we still don't have a response after retries, log and continue
      if (!response) {
        logger.error(
          `[AuthCallback] ❌ Webhook registration failed after ${
            maxRetries + 1
          } attempts`
        );
        throw new Error("Webhook registration failed after retries");
      }

      logger.debug(
        `[AuthCallback] Webhook registration response:`,
        JSON.stringify(response, null, 2)
      );

      // Shopify SDK returns webhook keys in uppercase with underscores (e.g., "ORDERS_CREATE")
      // Check orders/create webhook (try both formats)
      const ordersCreateResult =
        response["ORDERS_CREATE"] || response["orders/create"];
      if (
        ordersCreateResult &&
        Array.isArray(ordersCreateResult) &&
        ordersCreateResult.length > 0
      ) {
        const result = ordersCreateResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered orders/create webhook`
          );
        } else {
          // Extract error message from GraphQL response
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register orders/create webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but duplicate detection may be limited without webhooks.`
          );
          logger.debug(
            `[AuthCallback] Full error details:`,
            JSON.stringify(result, null, 2)
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ orders/create webhook registration response is missing or invalid:`,
          JSON.stringify(ordersCreateResult, null, 2)
        );
      }

      // Check orders/updated webhook (try both formats)
      const ordersUpdatedResult =
        response["ORDERS_UPDATED"] || response["orders/updated"];
      if (
        ordersUpdatedResult &&
        Array.isArray(ordersUpdatedResult) &&
        ordersUpdatedResult.length > 0
      ) {
        const result = ordersUpdatedResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered orders/updated webhook`
          );
        } else {
          // Extract error message from GraphQL response
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register orders/updated webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but duplicate detection may be limited without webhooks.`
          );
          logger.debug(
            `[AuthCallback] Full error details:`,
            JSON.stringify(result, null, 2)
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ orders/updated webhook registration response is missing or invalid:`,
          JSON.stringify(ordersUpdatedResult, null, 2)
        );
      }

      // Check app/uninstalled webhook (try both formats)
      const appUninstalledResult =
        response["APP_UNINSTALLED"] || response["app/uninstalled"];
      if (
        appUninstalledResult &&
        Array.isArray(appUninstalledResult) &&
        appUninstalledResult.length > 0
      ) {
        const result = appUninstalledResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered app/uninstalled webhook`
          );
        } else {
          // Extract error message from GraphQL response
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register app/uninstalled webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but app uninstall cleanup may not work without this webhook.`
          );
          logger.debug(
            `[AuthCallback] Full error details:`,
            JSON.stringify(result, null, 2)
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ app/uninstalled webhook registration response is missing or invalid:`,
          JSON.stringify(appUninstalledResult, null, 2)
        );
      }

      // Check app_subscriptions/update webhook (try both formats)
      const appSubscriptionsUpdateResult =
        response["APP_SUBSCRIPTIONS_UPDATE"] ||
        response["app_subscriptions/update"];
      if (
        appSubscriptionsUpdateResult &&
        Array.isArray(appSubscriptionsUpdateResult) &&
        appSubscriptionsUpdateResult.length > 0
      ) {
        const result = appSubscriptionsUpdateResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered app_subscriptions/update webhook`
          );
        } else {
          // Extract error message from GraphQL response
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register app_subscriptions/update webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but billing sync may not work without this webhook.`
          );
          logger.debug(
            `[AuthCallback] Full error details:`,
            JSON.stringify(result, null, 2)
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ app_subscriptions/update webhook registration response is missing or invalid:`,
          JSON.stringify(appSubscriptionsUpdateResult, null, 2)
        );
      }

      // Check customers/data_request webhook
      const customersDataRequestResult =
        response["CUSTOMERS_DATA_REQUEST"] ||
        response["customers/data_request"];
      if (
        customersDataRequestResult &&
        Array.isArray(customersDataRequestResult) &&
        customersDataRequestResult.length > 0
      ) {
        const result = customersDataRequestResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered customers/data_request webhook`
          );
        } else {
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register customers/data_request webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but GDPR data requests may not be processed without this webhook.`
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ customers/data_request webhook registration response is missing or invalid:`,
          JSON.stringify(customersDataRequestResult, null, 2)
        );
      }

      // Check customers/redact webhook
      const customersRedactResult =
        response["CUSTOMERS_REDACT"] || response["customers/redact"];
      if (
        customersRedactResult &&
        Array.isArray(customersRedactResult) &&
        customersRedactResult.length > 0
      ) {
        const result = customersRedactResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered customers/redact webhook`
          );
        } else {
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register customers/redact webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but GDPR customer data redaction may not work without this webhook.`
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ customers/redact webhook registration response is missing or invalid:`,
          JSON.stringify(customersRedactResult, null, 2)
        );
      }

      // Check shop/redact webhook
      const shopRedactResult =
        response["SHOP_REDACT"] || response["shop/redact"];
      if (
        shopRedactResult &&
        Array.isArray(shopRedactResult) &&
        shopRedactResult.length > 0
      ) {
        const result = shopRedactResult[0];
        if (result.success) {
          logger.info(
            `[AuthCallback] ✅ Successfully registered shop/redact webhook`
          );
        } else {
          const resultData = result.result as any;
          const errorMessage =
            resultData?.data?.webhookSubscriptionCreate?.userErrors?.[0]
              ?.message ||
            resultData?.errors?.[0]?.message ||
            "Unknown error";
          logger.warn(
            `[AuthCallback] ⚠️ Failed to register shop/redact webhook: ${errorMessage}`
          );
          logger.info(
            `[AuthCallback] 💡 This is non-blocking. The app will still function, but GDPR shop data redaction may not work without this webhook.`
          );
        }
      } else {
        logger.warn(
          `[AuthCallback] ⚠️ shop/redact webhook registration response is missing or invalid:`,
          JSON.stringify(shopRedactResult, null, 2)
        );
      }
    } catch (error: any) {
      logger.warn(
        `[AuthCallback] ⚠️ Error during webhook registration:`,
        error
      );
      logger.warn(`[AuthCallback] Error message: ${error.message}`);
      logger.info(
        `[AuthCallback] 💡 OAuth completed successfully. Webhook registration can be done manually later via the Settings page once Protected Customer Data access is approved.`
      );
      // Don't fail the OAuth flow if webhook registration fails - user can register manually later
    }

    // Handle existing charges on reinstall (Shopify Billing API requirement)
    // Apps must check for existing pending charges and handle charge acceptance/decline/approval
    try {
      logger.info(
        `[AuthCallback] Checking for existing charges for shop: ${session.shop}`
      );

      const appUrl = process.env.APP_URL || "http://localhost:5000";
      const returnUrl = `${appUrl}/subscription?upgrade=success`;

      const chargeStatus = await shopifyBillingService.handleExistingCharges(
        session.shop,
        session.accessToken || "",
        returnUrl
      );

      if (chargeStatus.hasActiveCharge && chargeStatus.activeCharge) {
        logger.info(
          `[AuthCallback] ✅ Found active charge ${chargeStatus.activeCharge.id}. Subscription synced to paid tier.`
        );
      }

      if (chargeStatus.hasPendingCharge && chargeStatus.pendingCharge) {
        logger.info(
          `[AuthCallback] ⚠️ Found pending charge ${chargeStatus.pendingCharge.id}. Merchant needs to approve this charge.`
        );
        logger.info(
          `[AuthCallback] 💡 Pending charge confirmation URL: ${chargeStatus.pendingCharge.confirmation_url}`
        );
        // Note: The merchant will need to visit the subscription page to approve the pending charge
        // The app_subscriptions/update webhook will handle activation when approved
      }
    } catch (error: any) {
      logger.warn(
        `[AuthCallback] ⚠️ Error checking existing charges (non-blocking):`,
        error
      );
      logger.info(
        `[AuthCallback] 💡 OAuth completed successfully. Charge handling can be done later via the Subscription page.`
      );
      // Don't fail the OAuth flow if charge checking fails
    }

    // Redirect to app with host param
    const host = req.query.host;
    const shop = session.shop;

    // Redirect to the embedded app URL
    // If running locally with ngrok, this might be different, but standard flow is:
    // https://admin.shopify.com/store/{shop}/apps/{api_key}
    // But since we are serving the frontend from the same domain, we can redirect to /?shop=...&host=...
    res.redirect(`/?shop=${shop}&host=${host}`);
  } catch (e: any) {
    logger.error(`Failed to complete auth callback: ${e.message}`);
    res.status(500).send(e.message);
  }
}

export async function verifyRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // DEVELOPMENT BYPASS
    // If we are in development mode and receive a specific dev token, bypass verification
    if (
      process.env.NODE_ENV !== "production" &&
      req.headers.authorization === "Bearer dev-token"
    ) {
      logger.info("[Auth] 🛡️ Using DEV BYPASS for authentication");
      res.locals.shopify = {
        shop: "test-shop.myshopify.com",
        accessToken: "shpat_dev_token_1234567890", // Dummy offline token
      };
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    logger.debug(`[Auth] Verifying request to ${req.path}`);
    logger.debug(`[Auth] Authorization header present: ${!!authHeader}`);

    if (!authHeader?.startsWith("Bearer ")) {
      logger.warn(`[Auth] Missing or invalid Bearer token for ${req.path}`);
      res.status(401).send("Unauthorized: Missing Bearer token");
      return;
    }

    const token = authHeader.substring(7);
    logger.debug(`[Auth] Token length: ${token.length}`);

    // Verify session token (JWT)
    // We use a custom verification to allow for clock tolerance
    // const payload = await shopify.session.decodeSessionToken(token);
    const payload = await decodeSessionTokenWithClockTolerance(token);
    const shop = payload.dest.replace("https://", "");
    logger.debug(`[Auth] Decoded token for shop: ${shop}`);

    // Load the offline session for this shop to get the access token
    // The offline session ID is usually "offline_{shop}"
    const offlineSessionId = shopify.session.getOfflineId(shop);
    logger.debug(`[Auth] Looking for offline session: ${offlineSessionId}`);
    const session = await shopify.config.sessionStorage.loadSession(
      offlineSessionId
    );

    if (!session || !session.accessToken) {
      logger.error(`[Auth] No offline session found for shop ${shop}`);
      // Return JSON with shop so frontend can redirect
      res.status(401).json({
        message: "Unauthorized: No valid session found",
        shop: shop,
        retryAuth: true,
      });
      return;
    }

    // Validate that this is actually an offline session
    if (session.isOnline) {
      logger.error(
        `[Auth] Session loaded is marked as ONLINE but should be OFFLINE for shop ${shop}. Session ID: ${session.id}`
      );
      res.status(401).json({
        message:
          "Unauthorized: Invalid session type. Please reinstall the app.",
        shop: shop,
        retryAuth: true,
        error: "Session is online but should be offline",
      });
      return;
    }

    // Validate access token format - offline tokens should start with 'shpat_' and be longer
    const sessionAccessToken = session.accessToken;
    const tokenPrefix = sessionAccessToken.substring(0, 6);
    const tokenLength = sessionAccessToken.length;

    logger.debug(
      `[Auth] Session token info - prefix: ${tokenPrefix}, length: ${tokenLength}, isOnline: ${session.isOnline}`
    );

    // Shopify offline tokens are 38 characters (shpat_ prefix + 32 random chars as of April 2020)
    // User tokens start with 'shpua_' and should not be used for API calls
    if (tokenPrefix === "shpua_") {
      logger.error(
        `[Auth] Session has USER ACCESS TOKEN (shpua_) instead of OFFLINE TOKEN (shpat_) for shop ${shop}. This is invalid for API calls.`
      );
      res.status(401).json({
        message:
          "Unauthorized: Invalid access token type. The app needs to be reinstalled to get a proper offline token.",
        shop: shop,
        retryAuth: true,
        error: "User access token found instead of offline token",
        requiresReinstall: true,
      });
      return;
    }

    // Warn only if token is significantly shorter than expected (38 chars), which would indicate truncation
    if (tokenLength < 30) {
      logger.warn(
        `[Auth] Access token is unusually short (${tokenLength} chars) for shop ${shop}. Expected 38 characters for offline tokens (shpat_ + 32 chars).`
      );
    }

    logger.debug(
      `[Auth] Session found for shop ${shop}, authentication successful. Token type: ${tokenPrefix}, length: ${tokenLength}`
    );

    // Store shop and accessToken in res.locals for downstream use
    res.locals.shopify = {
      shop,
      accessToken: sessionAccessToken,
    };

    next();
  } catch (e: any) {
    logger.error(`[Auth] Failed to verify request: ${e.message}`);
    logger.debug(`[Auth] Error stack: ${e.stack}`);
    res.status(401).json({ message: "Unauthorized", error: e.message });
  }
}

async function decodeSessionTokenWithClockTolerance(token: string) {
  const apiSecret = process.env.SHOPIFY_API_SECRET || "";
  const secretKey = createSecretKey(Buffer.from(apiSecret, "utf-8"));

  try {
    const { payload } = await jose.jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
      clockTolerance: 120, // 120 seconds tolerance to handle larger drifts
    });

    // Validate audience
    const apiKey = process.env.SHOPIFY_API_KEY || "";
    if (payload.aud !== apiKey) {
      throw new Error("Session token had invalid API key");
    }

    return payload as any; // Cast to any to match Shopify's JwtPayload type structure roughly
  } catch (error: any) {
    throw new Error(
      `Failed to parse session token '${token}': ${error.message}`
    );
  }
}
