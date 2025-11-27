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
shopify.webhooks.addHandlers({
  "orders/create": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/orders/create",
  },
  "orders/updated": {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/shopify/orders/updated",
  },
});

export { shopify };

export async function auth(req: Request, res: Response) {
  try {
    if (!req.query.shop) {
      res.status(500).send("No shop provided");
      return;
    }

    const shop = shopify.utils.sanitizeShop(req.query.shop as string, true)!;
    logger.info(`[Auth] Starting OAuth flow for shop: ${shop}, requesting OFFLINE token (isOnline: false)`);
    logger.info(`[Auth] App configuration - isEmbeddedApp: ${shopify.config.isEmbeddedApp}, API Key: ${shopify.config.apiKey?.substring(0, 10)}...`);

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
    logger.debug(`[AuthCallback] OAuth callback query params: ${JSON.stringify(Object.keys(queryParams))}`);

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
    logger.debug(`[AuthCallback] Full session details:`, {
      id: session.id,
      shop: session.shop,
      isOnline: session.isOnline,
      scope: session.scope,
      expires: session.expires?.toISOString(),
      tokenPrefix,
      tokenLength,
    });

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
    const response = await shopify.webhooks.register({
      session,
    });

    if (!response["orders/create"]?.[0]?.success) {
      logger.error(
        `Failed to register orders/create webhook: ${JSON.stringify(
          response["orders/create"]
        )}`
      );
    }

    if (!response["orders/updated"]?.[0]?.success) {
      logger.error(
        `Failed to register orders/updated webhook: ${JSON.stringify(
          response["orders/updated"]
        )}`
      );
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

    // Offline tokens typically start with 'shpat_' and are much longer (usually 40+ chars)
    // User tokens start with 'shpua_' and are shorter
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

    if (tokenLength < 40) {
      logger.warn(
        `[Auth] Access token is unusually short (${tokenLength} chars) for shop ${shop}. Expected 40+ characters for offline tokens.`
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
