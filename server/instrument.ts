/**
 * GlitchTip (Sentry-compatible) instrumentation for Node.js.
 * This file must be imported before any other application modules in the server entry.
 * @see https://glitchtip.com/sdkdocs/node
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.GLITCHTIP_DSN || process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.GLITCHTIP_RELEASE ?? undefined,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,
  });
}
