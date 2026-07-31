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

    expect(description).toContain("120 orders checked");
    expect(description).toContain("14 orders flagged for review");
    expect(description).toContain("4 duplicate-looking groups");
    expect(description).toContain("3 stronger matches (90–100%)");
    expect(description).toContain("11 need review (70–89%)");
    expect(description).toContain("Signals found: email, address, and name");
    expect(description).toContain("These are review signals, not automatic decisions.");
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

    expect(description).toContain("120 orders checked");
    expect(description).toContain("no duplicate-looking orders flagged");
    expect(description).toContain("Future new orders continue to be checked normally.");
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
