import { describe, expect, it } from "vitest";
import { formatHistoricalScanDescription } from "./historical-scan-summary";

const completedScan = {
  ordersFetched: 120,
  matchesFound: 4,
  flaggedOrders: 14,
  strongerFindings: 3,
  reviewFindings: 11,
  signals: ["email", "address", "name"] as const,
  candidateCapExceeded: false,
};

describe("formatHistoricalScanDescription", () => {
  it("explains mixed findings without calling them confirmed duplicates", () => {
    const description = formatHistoricalScanDescription(completedScan);

    expect(description).toContain("120 orders checked · 14 flagged in this scan.");
    expect(description).not.toContain("duplicate-looking groups");
    expect(description).toContain("3 strong matches · 11 need review.");
    expect(description).not.toContain("Signals found:");
    expect(description.toLowerCase()).not.toContain("confirmed duplicate");
  });

  it("handles a completed scan with no findings", () => {
    const description = formatHistoricalScanDescription({
      ...completedScan,
      matchesFound: 0,
      flaggedOrders: 0,
      strongerFindings: 0,
      reviewFindings: 0,
      signals: [],
    });

    expect(description).toBe("120 orders checked · none flagged.");
  });

  it("uses singular order and review wording", () => {
    const description = formatHistoricalScanDescription({
      ...completedScan,
      ordersFetched: 1,
      flaggedOrders: 1,
      strongerFindings: 0,
      reviewFindings: 1,
    });

    expect(description).toBe("1 order checked · 1 flagged in this scan. 1 needs review.");
  });

  it("includes the partial-check warning when the candidate cap was reached", () => {
    expect(
      formatHistoricalScanDescription({
        ...completedScan,
        candidateCapExceeded: true,
      })
    ).toContain("High-volume periods were partially checked");
  });
});
