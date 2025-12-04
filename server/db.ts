import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Support both DATABASE_URL and POSTGRES_* environment variables
// Priority: DATABASE_URL > construct from POSTGRES_*
let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  const host = process.env.POSTGRES_HOST || 'postgres'; // Default to 'postgres' for Docker
  const port = process.env.POSTGRES_PORT || '5432';
  
  if (POSTGRES_USER && POSTGRES_PASSWORD && POSTGRES_DB) {
    databaseUrl = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${port}/${POSTGRES_DB}`;
    console.log('[Database] Constructed DATABASE_URL from POSTGRES_* environment variables');
  } else {
    throw new Error(
      "Database connection not configured. Set DATABASE_URL or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB environment variables.",
    );
  }
}

// Configure connection pool for production scalability
// See: https://node-postgres.com/apis/pool
export const pool = new Pool({
  connectionString: databaseUrl,
  // Maximum number of clients in the pool
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  // Minimum number of idle clients to maintain
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  // Close idle clients after 30 seconds
  idleTimeoutMillis: 30000,
  // Timeout for acquiring a new connection
  connectionTimeoutMillis: 5000,
  // Keep pool alive even when idle
  allowExitOnIdle: false,
});

// Handle unexpected errors on idle clients
pool.on('error', (err) => {
  console.error('[Database] Unexpected error on idle PostgreSQL client:', err.message);
});

export const db = drizzle(pool, { schema });
