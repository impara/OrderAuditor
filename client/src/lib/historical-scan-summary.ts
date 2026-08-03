export type HistoricalScanSignal = "email" | "phone" | "address" | "name" | "sku";

export interface HistoricalScanDescriptionInput {
  ordersFetched: number;
  matchesFound: number;
  flaggedOrders: number;
  strongerFindings: number;
  reviewFindings: number;
  signals: readonly HistoricalScanSignal[];
  candidateCapExceeded: boolean;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return value === 1 ? singular : pluralForm;
}

export function formatHistoricalScanDescription(
  scan: HistoricalScanDescriptionInput
): string {
  const checkedLabel = `${scan.ordersFetched} checked`;

  if (scan.flaggedOrders === 0) {
    return `${checkedLabel} · none flagged.`;
  }

  let description = `${checkedLabel} · ${scan.flaggedOrders} flagged.`;

  const confidenceParts: string[] = [];
  if (scan.strongerFindings > 0) {
    confidenceParts.push(
      `${scan.strongerFindings} strong ${plural(scan.strongerFindings, "match", "matches")}`
    );
  }
  if (scan.reviewFindings > 0) {
    confidenceParts.push(
      `${scan.reviewFindings} ${scan.reviewFindings === 1 ? "needs" : "need"} closer review`
    );
  }
  if (confidenceParts.length > 0) {
    description += ` ${confidenceParts.join(" · ")}.`;
  }

  description += scan.candidateCapExceeded
    ? " High-volume periods were partially checked; review the available results."
    : "";

  return description;
}
