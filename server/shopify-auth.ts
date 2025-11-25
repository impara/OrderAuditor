import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion, BillingInterval } from "@shopify/shopify-api";
import { PostgresSessionStorage } from "./shopify-session-storage";
import { Request, Response, NextFunction } from "express";
import { logger } from "./utils/logger";

// Initialize Shopify API client
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_WEBHOOK_SECRET || "", // Using webhook secret as API secret
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

export { shopify };

export async function auth(req: Request, res: Response) {
  try {
    if (!req.query.shop) {
      res.status(500).send("No shop provided");
      return;
    }

    // The library handles the redirect to Shopify
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(req.query.shop as string, true)!,
      callbackPath: "/api/auth/callback",
      isOnline: false, // Offline token for background jobs (webhooks)
      rawRequest: req,
      rawResponse: res,
    });
  } catch (e: any) {
    logger.error(`Failed to begin auth: ${e.message}`);
    res.status(500).send(e.message);
  }
}

export async function authCallback(req: Request, res: Response) {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callback;

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
    const payload = await shopify.session.decodeSessionToken(token);
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
      res.status(401).send("Unauthorized: No valid session found");
      return;
    }

    logger.debug(
      `[Auth] Session found for shop ${shop}, authentication successful`
    );

    // Store shop and accessToken in res.locals for downstream use
    res.locals.shopify = {
      shop,
      accessToken: session.accessToken,
    };

    next();
  } catch (e: any) {
    logger.error(`[Auth] Failed to verify request: ${e.message}`);
    logger.debug(`[Auth] Error stack: ${e.stack}`);
    res.status(401).send("Unauthorized");
  }
}
