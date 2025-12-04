import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { logger } from "./utils/logger";

async function runMigrations() {
  // Support both DATABASE_URL and POSTGRES_* environment variables
  // Priority: DATABASE_URL > construct from POSTGRES_*
  let databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
    const host = process.env.POSTGRES_HOST || 'postgres';
    const port = process.env.POSTGRES_PORT || '5432';
    
    if (POSTGRES_USER && POSTGRES_PASSWORD && POSTGRES_DB) {
      databaseUrl = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${port}/${POSTGRES_DB}`;
      logger.info('[Migration] Constructed DATABASE_URL from POSTGRES_* environment variables');
    } else {
      throw new Error(
        "Database connection not configured. Set DATABASE_URL or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB environment variables.",
      );
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
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
