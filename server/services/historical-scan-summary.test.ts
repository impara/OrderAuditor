import { describe, expect, it } from "vitest";
import { summarizeHistoricalScanFindings } from "./historical-scan-summary";

describe("summarizeHistoricalScanFindings", () => {
  it("returns an empty summary for no findings", () => {
    expect(summarizeHistoricalScanFindings([])).toEqual({
      flaggedOrders: 0,
      strongerFindings: 0,
      reviewFindings: 0,
      signals: [],
    });
  });

  it("classifies confidence boundaries without changing detection", () => {
    const findings = [
      { matchConfidence: 70, matchReason: "Same email, Same name" },
      { matchConfidence: 89, matchReason: "Similar address" },
      { matchConfidence: 90, matchReason: "Same phone" },
      { matchConfidence: 100, matchReason: "Same SKU purchased" },
    ];

    expect(summarizeHistoricalScanFindings(findings)).toEqual({
      flaggedOrders: 4,
      strongerFindings: 2,
      reviewFindings: 2,
      signals: ["email", "phone", "address", "name", "sku"],
    });
    expect(findings[0].matchConfidence).toBe(70);
  });

  it("deduplicates signals and tolerates malformed values", () => {
    expect(
      summarizeHistoricalScanFindings([
        { matchConfidence: null, matchReason: null },
        { matchConfidence: 95, matchReason: "Same email, same EMAIL" },
        { matchConfidence: Number.NaN, matchReason: "Unknown reason" },
      ])
    ).toEqual({
      flaggedOrders: 3,
      strongerFindings: 1,
      reviewFindings: 0,
      signals: ["email"],
    });
  });
});
