import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  new URL("../../server/shopify-auth.ts", import.meta.url),
  "utf8"
);
const routesSource = readFileSync(
  new URL("../../server/routes.ts", import.meta.url),
  "utf8"
);

describe("Partner-development shop conversion wiring", () => {
  it("registers and handles shop/update through the existing webhook architecture", () => {
    expect(authSource).toContain('"shop/update": {');
    expect(authSource).toContain(
      'callbackUrl: "/api/webhooks/shopify/shop/update"'
    );
    expect(routesSource).toContain('"shop/update",');
    expect(routesSource).toContain(
      '"/api/webhooks/shopify/shop/update"'
    );
    expect(routesSource).toContain(
      "shopEntitlementService.handleShopUpdate("
    );
  });
});
