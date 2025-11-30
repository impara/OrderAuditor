import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { type Server } from "node:http";

import express, { type Express } from "express";
import runApp from "./app";

export async function serveStatic(app: Express, _server: Server) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
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
  await runApp(serveStatic);
})();
