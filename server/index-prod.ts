import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { type Server } from "node:http";
import { execSync } from "node:child_process";

import express, { type Express } from "express";
import runApp from "./app";

/**
 * Push database schema changes on startup using drizzle-kit push.
 * This ensures the database schema is always in sync with the code.
 */
async function pushDatabaseSchema(): Promise<void> {
  console.log("[Startup] Pushing database schema...");
  
  try {
    execSync("npx drizzle-kit push --force", {
      stdio: "inherit",
      env: process.env,
    });
    console.log("[Startup] Database schema push completed successfully");
  } catch (error) {
    console.error("[Startup] Database schema push failed:", error);
    process.exit(1);
  }
}

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
  app.use("*", async (_req, res, next) => {
    const indexPath = path.resolve(distPath, "index.html");
    
    try {
      // Read and inject API key into HTML template
      let html = await fs.promises.readFile(indexPath, "utf-8");
      const apiKey = process.env.SHOPIFY_API_KEY || process.env.VITE_SHOPIFY_API_KEY || "";
      html = html.replace("__SHOPIFY_API_KEY__", apiKey);
      
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      next(e);
    }
  });
}

(async () => {
  // Push database schema before starting the app
  await pushDatabaseSchema();
  await runApp(serveStatic);
})();
