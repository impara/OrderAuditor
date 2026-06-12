/**
 * Generates a local HTML preview of the duplicate alert email.
 * Usage: npx tsx scripts/preview-alert-email.ts
 *
 * The notification service transitively imports server/db.ts, which requires
 * database env vars at module load even though this script never touches the
 * database. Set a placeholder before the dynamic import so the script runs
 * standalone (a real DATABASE_URL from the environment takes precedence).
 */
import { writeFileSync } from "fs";

process.env.DATABASE_URL ||=
  "postgresql://preview:preview@localhost:5432/preview";

const { NotificationService } = await import(
  "../server/services/notification.service"
);

const service = new NotificationService();

const now = new Date();
const earlier = new Date(now.getTime() - 17 * 60 * 1000);

const sampleData = {
  order: {
    orderNumber: "#1042",
    customerName: "Jane Smith",
    customerEmail: "jane.smith@example.com",
    totalPrice: "149.00",
    currency: "USD",
    createdAt: now,
    shopifyOrderId: "1111111",
  },
  duplicateOf: {
    orderNumber: "#1038",
    customerName: "Jane Smith",
    customerEmail: "jane.smith@example.com",
    totalPrice: "149.00",
    currency: "USD",
    createdAt: earlier,
    shopifyOrderId: "2222222",
  },
  confidence: 92,
  matchReason: "Same customer email, identical total, placed within 30 minutes",
};

const html = (service as any).formatEmailHtml(
  "demo-store.myshopify.com",
  sampleData
);

writeFileSync("/tmp/duplicate-alert-preview.html", html);
console.log("Preview written to /tmp/duplicate-alert-preview.html");
