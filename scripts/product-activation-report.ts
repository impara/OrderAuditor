import { pool } from "../server/db";

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Number(daysArg?.split("=")[1] ?? "30");
if (!Number.isInteger(days) || days < 1 || days > 365) {
  throw new Error("--days must be an integer from 1 to 365");
}

const result = await pool.query<{
  event_name: string;
  event_count: string;
  shop_count: string;
  first_seen: Date;
  last_seen: Date;
}>(`
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
