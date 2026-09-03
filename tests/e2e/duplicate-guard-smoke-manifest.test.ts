import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/testing/shopify-e2e-smoke-manifest.template.json",
      import.meta.url
    ),
    "utf8"
  )
);

const REQUIRED_EVIDENCE_FIELDS = [
  "schema_version",
  "run_id",
  "app",
  "app_id",
  "repo_commit",
  "github_source_revision",
  "image_id",
  "image_tag",
  "effective_config_checked",
  "store_domain",
  "store_slug",
  "partner_development",
  "admin_dev_badge",
  "scenarios",
  "receipts",
  "cleanup",
  "untested_boundaries",
  "started_at",
  "finished_at",
  "verdict",
];

describe("Duplicate Guard Shopify E2E smoke manifest", () => {
  it("matches the shared evidence contract and fixed target", () => {
    for (const field of REQUIRED_EVIDENCE_FIELDS) {
      expect(manifest).toHaveProperty(field);
    }
    expect(manifest).toMatchObject({
      schema_version: "1.0",
      app: "duplicate-guard",
      app_id: "298472144897",
      store_domain: "order-auditor-test-2.myshopify.com",
      store_slug: "order-auditor-test-2",
      partner_development: true,
      effective_config_checked: true,
    });
  });

  it("uses a unique run ID in every fixture identifier", () => {
    expect(manifest.fixture.prefix).toContain("{{run_id}}");
    expect(manifest.fixture.shared_email).toContain("{{run_id}}");
    expect(manifest.fixture.shared_name).toContain("{{run_id}}");
    expect(manifest.fixture.shared_address).toContain("{{run_id}}");
    expect(manifest.fixture.control_email).toContain("{{run_id}}");
    expect(manifest.fixture.control_name).toContain("{{run_id}}");
    expect(manifest.fixture.control_address).toContain("{{run_id}}");
    expect(manifest.fixture.seed_tag).toContain("{{run_id}}");
    expect(manifest.fixture.duplicate_tag).toContain("{{run_id}}");
    expect(manifest.fixture.control_tag).toContain("{{run_id}}");
    expect(manifest.fixture.notifications).toBe(false);
  });

  it("requires duplicate UI isolation billing and reversible cleanup evidence", () => {
    const scenarioNames = manifest.scenarios.map(
      (scenario: { name: string }) => scenario.name
    );
    expect(scenarioNames).toContain(
      "duplicate fixture is flagged in Shopify and review UI"
    );
    expect(scenarioNames).toContain(
      "control and pre-existing unrelated orders remain untouched"
    );
    expect(scenarioNames).toContain(
      "upgrade attempt creates no recurring charge or fake paid subscription"
    );
    expect(manifest.cleanup).toMatchObject({
      required: true,
      status: "completed",
    });
    expect(manifest.cleanup.actions.join(" ")).toMatch(/Cancel/);
    expect(manifest.cleanup.actions.join(" ")).toMatch(/Archive/);
  });
});
