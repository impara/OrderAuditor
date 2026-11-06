import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Import the real app middleware without starting queues, DB or Shopify traffic.
vi.mock("./routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("@sentry/node", () => ({ setupExpressErrorHandler: vi.fn() }));
vi.mock("./utils/logger", () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SECRET = "synthetic-webhook-body-limit-regression";
const LIMIT = 2 * 1024 * 1024;
const paths = [
  "/api/webhooks/shopify/orders/create",
  "/api/webhooks/shopify/orders/updated",
  "/api/webhooks/shopify",
];
let server: Server;
let port: number;
let handlerCalls = 0;

function payload(bytes: number): Buffer {
  // Deliberate whitespace and non-ASCII bytes catch parse/reserialize corruption.
  const prefix = Buffer.from('{\n  "message": "æ🛡", "padding": "');
  const suffix = Buffer.from('"\n}\n');
  return Buffer.concat([prefix, Buffer.alloc(bytes - prefix.length - suffix.length, 120), suffix]);
}

function signature(body: Buffer): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

function post(path: string, body: Buffer, hmac?: string, chunked = false) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path, method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(chunked ? {} : { "Content-Length": body.length }),
        ...(hmac === undefined ? {} : { "X-Shopify-Hmac-Sha256": hmac }),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("Synthetic webhook request timed out")));
    if (chunked) {
      for (let offset = 0; offset < body.length; offset += 16384) req.write(body.subarray(offset, offset + 16384));
      req.end();
    } else req.end(body);
  });
}

beforeAll(async () => {
  vi.stubEnv("SHOPIFY_API_SECRET", SECRET);
  vi.stubEnv("SHOPIFY_WEBHOOK_SECRET", "");
  const { app } = await import("./app");
  const { ShopifyService } = await import("./services/shopify.service");
  const verifier = new ShopifyService();

  // Synthetic downstream endpoints exercise the actual app's parser stack and
  // production signature verifier, not merchant processing/DB/queue side effects.
  for (const path of paths) {
    app.post(path, (req, res) => {
      handlerCalls++;
      const hmac = req.get("X-Shopify-Hmac-Sha256");
      if (!hmac || !verifier.verifyWebhook(req.body, hmac)) return res.status(401).json({ error: "Invalid signature" });
      return res.json({ raw: Buffer.isBuffer(req.body), bytes: req.body.length, digest: signature(req.body) });
    });
  }
  app.post("/api/non-webhook", (req, res) => res.json({ parsed: typeof req.body.padding === "string" }));
  app.post("/api/webhooks/shopify-other", (_req, res) => res.json({ accepted: true }));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ type: error.type }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
});

describe("Shopify webhook body admission in the actual app middleware", () => {
  for (const path of paths) {
    for (const bytes of [102400, 102401, 200 * 1024, LIMIT]) {
      it(`accepts a signed ${bytes}-byte raw body on ${path}`, async () => {
        const body = payload(bytes);
        const response = await post(path, body, signature(body));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ raw: true, bytes, digest: signature(body) });
      });
    }
  }

  it("accepts a signed chunked body above the previous limit", async () => {
    const body = payload(200 * 1024);
    const response = await post(paths[1], body, signature(body), true);
    expect(response).toEqual({ status: 200, body: { raw: true, bytes: body.length, digest: signature(body) } });
  });

  for (const chunked of [false, true]) {
    it(`rejects one byte over 2 MiB before downstream processing (chunked=${chunked})`, async () => {
      const body = payload(LIMIT + 1);
      const before = handlerCalls;
      const response = await post(paths[1], body, signature(body), chunked);
      expect(response).toEqual({ status: 413, body: { type: "entity.too.large" } });
      expect(handlerCalls).toBe(before);
    });
  }

  it("still rejects a missing signature on a large accepted-size body", async () => {
    expect((await post(paths[1], payload(200 * 1024))).status).toBe(401);
  });

  it("still rejects a mismatched signature on a large accepted-size body", async () => {
    const body = payload(200 * 1024);
    expect((await post(paths[1], body, signature(Buffer.from("different bytes")))).status).toBe(401);
  });

  it("still rejects a malformed signature instead of throwing", async () => {
    expect((await post(paths[1], payload(200 * 1024), "invalid")).status).toBe(401);
  });

  it("still rejects a body altered after signing", async () => {
    const body = payload(200 * 1024);
    const hmac = signature(body);
    body[body.length - 6] ^= 1;
    expect((await post(paths[0], body, hmac)).status).toBe(401);
  });

  it("does not raise the ordinary JSON request limit", async () => {
    expect(await post("/api/non-webhook", payload(102401))).toEqual({ status: 413, body: { type: "entity.too.large" } });
  });

  it("does not admit a webhook-prefix lookalike through the larger limit", async () => {
    expect(await post("/api/webhooks/shopify-other", payload(102401))).toEqual({ status: 413, body: { type: "entity.too.large" } });
  });

  it("still parses ordinary small JSON bodies", async () => {
    expect(await post("/api/non-webhook", payload(1024))).toEqual({ status: 200, body: { parsed: true } });
  });
});
