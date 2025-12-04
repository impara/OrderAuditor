import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { logger } from "./utils/logger";

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  logger.info("Running database migrations...");

  try {
    // This will run migrations from the migrations folder
    await migrate(db, { migrationsFolder: "migrations" });
    logger.info("Migrations completed successfully");
  } catch (error) {
    logger.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}

export { runMigrations };
