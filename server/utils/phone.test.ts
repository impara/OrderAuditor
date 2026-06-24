import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "./phone";

describe("normalizePhoneNumber", () => {
  it("normalizes US 10-digit numbers to +1 prefix", () => {
    expect(normalizePhoneNumber("5551234567")).toBe("+15551234567");
  });

  it("preserves international numbers with leading plus", () => {
    expect(normalizePhoneNumber("+45 12 34 56 78")).toBe("+4512345678");
  });

  it("returns empty string for missing values", () => {
    expect(normalizePhoneNumber(null)).toBe("");
    expect(normalizePhoneNumber(undefined)).toBe("");
  });
});
