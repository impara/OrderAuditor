export const HISTORICAL_SCAN_SIGNALS = [
  "email",
  "phone",
  "address",
  "name",
  "sku",
] as const;

export type HistoricalScanSignal = (typeof HISTORICAL_SCAN_SIGNALS)[number];

export interface HistoricalScanFinding {
  matchConfidence: number | null;
  matchReason: string | null;
}

export interface HistoricalScanFindingSummary {
  flaggedOrders: number;
  strongerFindings: number;
  reviewFindings: number;
  signals: HistoricalScanSignal[];
}

export function emptyHistoricalScanFindingSummary(): HistoricalScanFindingSummary {
  return {
    flaggedOrders: 0,
    strongerFindings: 0,
    reviewFindings: 0,
    signals: [],
  };
}

export function summarizeHistoricalScanFindings(
  findings: readonly HistoricalScanFinding[]
): HistoricalScanFindingSummary {
  let strongerFindings = 0;
  let reviewFindings = 0;
  const foundSignals = new Set<HistoricalScanSignal>();

  for (const finding of findings) {
    const confidence = finding.matchConfidence;
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      if (confidence >= 90 && confidence <= 100) {
        strongerFindings += 1;
      } else if (confidence >= 70 && confidence < 90) {
        reviewFindings += 1;
      }
    }

    const reason = finding.matchReason?.toLowerCase() ?? "";
    for (const signal of HISTORICAL_SCAN_SIGNALS) {
      if (reason.includes(signal)) {
        foundSignals.add(signal);
      }
    }
  }

  return {
    flaggedOrders: findings.length,
    strongerFindings,
    reviewFindings,
    signals: HISTORICAL_SCAN_SIGNALS.filter((signal) => foundSignals.has(signal)),
  };
}
