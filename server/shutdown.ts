import { type Server } from "node:http";

import { pool } from "./db";
import { queueService } from "./services/queue.service";
import { logger } from "./utils/logger";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = parseInt(
  process.env.SHUTDOWN_TIMEOUT_MS || "25000",
  10
);

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function setupGracefulShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`[Shutdown] Received ${signal}, starting graceful shutdown...`);

    const forceExitTimer = setTimeout(() => {
      logger.error(
        `[Shutdown] Timed out after ${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms, forcing exit`
      );
      process.exit(1);
    }, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          logger.info("[Shutdown] HTTP server closed");
          resolve();
        });
      });

      await queueService.stop({
        graceful: true,
        wait: true,
        timeout: DEFAULT_SHUTDOWN_TIMEOUT_MS - 2000,
      });

      await pool.end();
      logger.info("[Shutdown] Database pool closed");

      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error("[Shutdown] Error during graceful shutdown:", error);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
