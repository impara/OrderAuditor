import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const deployScriptPath = resolve(root, "deploy.sh");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function callDeployFunction(functionCall: string, ...args: string[]) {
  return spawnSync(
    "bash",
    ["-c", `source "$1"; ${functionCall}`, "bash", deployScriptPath, ...args],
    { encoding: "utf8" },
  );
}

describe("immutable production release path", () => {
  it("publishes an exact full-SHA tag while retaining compatibility tags", () => {
    const workflow = read(".github/workflows/deploy.yml");

    expect(workflow).toContain("type=raw,value=sha-${{ github.sha }}");
    expect(workflow).toContain("type=ref,event=branch");
    expect(workflow).toContain("type=sha,prefix={{branch}}-");
    expect(workflow).toContain(
      "type=raw,value=latest,enable={{is_default_branch}}",
    );
  });

  it("lets both application slots use the selected image with a latest fallback", () => {
    const compose = read("docker-compose.prod.yml");
    const selectedImageLines = compose.match(
      /image: \$\{ORDERAUDITOR_IMAGE:-ghcr\.io\/impara\/orderauditor:latest\}/g,
    );

    expect(selectedImageLines).toHaveLength(2);
  });

  it("derives the immutable image from all 40 commit characters", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const result = callDeployFunction('image_for_commit "$2"', commit);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      `ghcr.io/impara/orderauditor:sha-${commit}`,
    );
  });

  it("fails closed when the OCI revision does not match", () => {
    const expected = "0123456789abcdef0123456789abcdef01234567";
    const actual = "89abcdef0123456789abcdef0123456789abcdef";
    const result = callDeployFunction(
      'verify_image_revision "$2" "$3"',
      expected,
      actual,
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `image revision ${actual} does not match checkout ${expected}`,
    );
  });

  it("checks provenance before migrations and preserves blue/green rollback", () => {
    const script = read("deploy.sh");

    execFileSync("bash", ["-n", deployScriptPath]);
    expect(script).toContain("DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}");
    expect(script).toContain('git status --porcelain');
    expect(script).toContain('git fetch origin "$DEPLOY_BRANCH"');
    expect(script).toContain('git merge --ff-only "origin/$DEPLOY_BRANCH"');
    expect(script).toContain(
      'ORDERAUDITOR_IMAGE=$(image_for_commit "$commit_sha")',
    );
    expect(script).toContain('docker pull "$ORDERAUDITOR_IMAGE"');
    expect(script).toContain("org.opencontainers.image.revision");
    expect(script).toContain('docker ps --filter "publish=$ACTIVE_PORT"');
    expect(script).toContain(
      'rollback_to_service "$ACTIVE" "$previous_image_id"',
    );

    const revisionCheck = script.indexOf(
      'verify_image_revision "$commit_sha" "$image_revision"',
    );
    const migration = script.indexOf(
      'compose run --rm --no-deps "$INACTIVE" npm run db:migrate',
    );
    const trafficStop = script.indexOf('compose stop "$ACTIVE"');

    expect(revisionCheck).toBeGreaterThan(-1);
    expect(revisionCheck).toBeLessThan(migration);
    expect(revisionCheck).toBeLessThan(trafficStop);
  });
});
