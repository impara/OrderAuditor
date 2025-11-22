import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";
import session from "express-session";
import MemoryStore from "memorystore";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { registerRoutes } from "./routes";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();

// Trust proxy - we're behind Replit's reverse proxy
app.set('trust proxy', 1);

declare module 'http' {
  interface IncomingMessage {
    rawBody: Buffer;
  }
}

// Security headers with helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Only allow unsafe-inline in development for Vite HMR
      scriptSrc: process.env.NODE_ENV === 'production' 
        ? ["'self'"]
        : ["'self'", "'unsafe-inline'"],
      styleSrc: process.env.NODE_ENV === 'production'
        ? ["'self'"]
        : ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https:"], // Allow Shopify API and Vite HMR
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  } : false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || true // Default to same-origin in production
    : true, // Allow all origins in development
  credentials: true, // Allow cookies
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  console.warn('⚠️  WARNING: ALLOWED_ORIGINS not set in production. Using same-origin policy.');
  console.warn('   Set ALLOWED_ORIGINS to enable cross-origin requests if needed.');
}

// CRITICAL: Webhook rate limiter MUST come before general API rate limiter
// Webhook rate limiter (more lenient for Shopify - 60 requests per minute)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute max
  message: 'Too many webhook requests, please try again later.',
});
app.use('/api/webhooks/', webhookLimiter);

// Note: Raw body handling for webhooks is now done at the route level in routes.ts
// to avoid conflicts with general JSON parsing middleware

// Session configuration
const MemStore = MemoryStore(session);
const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-in-production";

if (process.env.NODE_ENV === 'production' && sessionSecret === "dev-secret-change-in-production") {
  console.warn("⚠️  WARNING: Using default SESSION_SECRET in production! Set SESSION_SECRET environment variable.");
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new MemStore({
    checkPeriod: 86400000 // Prune expired entries every 24h
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Require HTTPS in production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // CSRF protection
  }
}));

// Rate limiting for general API routes (applied after webhook routes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all non-webhook API routes
app.use('/api/', (req, res, next) => {
  // Skip rate limiting for webhooks (already handled above)
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }
  return apiLimiter(req, res, next);
});

// Stricter rate limit for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true, // Don't count successful requests
});

app.use('/api/auth/login', authLimiter);

// CRITICAL: Skip JSON parsing for webhook routes - they need raw body for HMAC verification
// Use express.json for all other routes (non-webhook)
app.use((req, res, next) => {
  // Skip JSON parsing for Shopify webhooks - they use route-level express.raw()
  if (req.path.startsWith('/api/webhooks/shopify')) {
    return next();
  }
  return express.json()(req, res, next);
});

app.use((req, res, next) => {
  // Skip URL encoding for Shopify webhooks
  if (req.path.startsWith('/api/webhooks/shopify')) {
    return next();
  }
  return express.urlencoded({ extended: false })(req, res, next);
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  const server = await registerRoutes(app);

  // Centralized error handling
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    
    // Log error details for debugging (includes stack trace)
    console.error('[Error Handler]', {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    // Sanitize error message for client
    let message = "Internal Server Error";
    if (status < 500) {
      // Client errors (4xx) can show specific message
      message = err.message || message;
    } else {
      // Server errors (5xx) should not expose internal details
      message = process.env.NODE_ENV === 'development' 
        ? err.message 
        : "An unexpected error occurred. Please try again later.";
    }

    res.status(status).json({ 
      error: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
}
