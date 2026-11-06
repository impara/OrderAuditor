import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const version = "22.23.4";
const base = `node:${version}-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202`;

describe("supported Node runtime", () => {
  it("requires the patched Node 22 line in npm and local tooling", () => {
    expect(JSON.parse(read("package.json")).engines.node).toBe(">=22.23.4 <23");
    expect(JSON.parse(read("package-lock.json")).packages[""].engines.node).toBe(">=22.23.4 <23");
    expect(read(".nvmrc").trim()).toBe(version);
    expect(read(".npmrc")).toMatch(/^engine-strict=true$/m);
  });

  it("pins both image stages and enforces engines during image installation", () => {
    const dockerfile = read("Dockerfile");
    expect([...dockerfile.matchAll(/^FROM (\S+)/gm)].map((m) => m[1])).toEqual([base, base]);
    expect(dockerfile.match(/^COPY package\.json package-lock\.json \.npmrc \.\/$/gm)).toHaveLength(2);
  });

  it("uses the same patched runtime in every GitHub workflow", () => {
    const workflows = new URL(".github/workflows/", root);
    const values = readdirSync(workflows)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) => [...readFileSync(new URL(name, workflows), "utf8").matchAll(/node-version:\s*(.+)/g)].map((m) => m[1].trim()));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(`"${version}"`);
  });
});
