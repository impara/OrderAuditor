import "dotenv/config";
import "./instrument";
import fs from "node:fs";
import path from "node:path";
import { type Server } from "node:http";

import { nanoid } from "nanoid";
import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";

import viteConfig from "../vite.config";
import runApp from "./app";

export async function setupVite(app: Express, server: Server) {
  const viteLogger = createLogger();
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      const isInternalAdminRoute =
        url.startsWith("/internal-admin") ||
        url.startsWith("/webhook-ops/internal/");
      
      // Inject Shopify API key into the template
      const apiKey = isInternalAdminRoute
        ? ""
        : process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_API_KEY || "";
      template = template.replace("__SHOPIFY_API_KEY__", apiKey);
      template = template.replace("__APP_URL__", process.env.APP_URL || "");
      if (isInternalAdminRoute) {
        template = template.replace(
          '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>',
          ""
        );
      }
      
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

import { queueService } from "./services/queue.service";
import { webhookWorker } from "./workers/webhook-worker";
import { historicalScanWorker } from "./workers/historical-scan-worker";
import { setupGracefulShutdown } from "./shutdown";

(async () => {
  await queueService.initialize();
  await webhookWorker.start();
  await historicalScanWorker.start();

  const server = await runApp(setupVite);
  setupGracefulShutdown(server);
})().catch((error) => {
  console.error("[Startup] Fatal error:", error);
  process.exit(1);
});
