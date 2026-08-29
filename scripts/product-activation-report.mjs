import pg from "pg";

const { Pool } = pg;
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;
  const host = process.env.POSTGRES_HOST || "postgres";
  const port = process.env.POSTGRES_PORT || "5432";
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error("Database connection is not configured");
  }
  databaseUrl = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${port}/${POSTGRES_DB}`;
}

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Number(daysArg?.split("=")[1] ?? "30");
if (!Number.isInteger(days) || days < 1 || days > 365) {
  throw new Error("--days must be an integer from 1 to 365");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const result = await pool.query(`
  SELECT
    event_name,
    COUNT(*)::text AS event_count,
    COUNT(DISTINCT shop_domain)::text AS shop_count,
    MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen
  FROM product_events
  WHERE occurred_at >= NOW() - ($1::integer * INTERVAL '1 day')
  GROUP BY event_name
  ORDER BY event_name
`, [days]);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  windowDays: days,
  privacy: "Aggregate counts only; no shop domains, customers, or orders.",
  events: result.rows.map((row) => ({
    eventName: row.event_name,
    eventCount: Number(row.event_count),
    shopCount: Number(row.shop_count),
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
  })),
}, null, 2));

await pool.end();