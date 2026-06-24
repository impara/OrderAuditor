import "dotenv/config";
import "./instrument";
import fs from "node:fs";
import path from "node:path";
import { type Server } from "node:http";

import express, { type Express } from "express";
import runApp from "./app";
import { setupGracefulShutdown } from "./shutdown";

export async function serveStatic(app: Express, _server: Server) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static files, but exclude index.html so it goes through the replacement logic
  app.use(express.static(distPath, {
    index: false, // Don't serve index.html automatically
  }));

  // Always serve index.html with API key injection for all routes
  app.use("*", async (req, res, next) => {
    const indexPath = path.resolve(distPath, "index.html");
    
    try {
      // Read and inject API key into HTML template
      let html = await fs.promises.readFile(indexPath, "utf-8");
      const isInternalAdminRoute =
        req.originalUrl.startsWith("/internal-admin") ||
        req.originalUrl.startsWith("/webhook-ops/internal/");
      const apiKey = isInternalAdminRoute
        ? ""
        : process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_API_KEY || "";
      html = html.replace("__SHOPIFY_API_KEY__", apiKey);
      html = html.replace("__APP_URL__", process.env.APP_URL || "");
      if (isInternalAdminRoute) {
        html = html.replace(
          '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>',
          ""
        );
      }
      
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      next(e);
    }
  });
}

import { queueService } from "./services/queue.service";
import { webhookWorker } from "./workers/webhook-worker";

(async () => {
  // Schema migrations run as a one-off step in deploy.sh (npm run db:migrate).

  await queueService.initialize();
  await webhookWorker.start();

  const server = await runApp(serveStatic);
  setupGracefulShutdown(server);
})().catch((error) => {
  console.error("[Startup] Fatal error:", error);
  process.exit(1);
});
