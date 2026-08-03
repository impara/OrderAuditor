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
  const parts: string[] = [`${scan.ordersFetched} orders checked`];

  if (scan.flaggedOrders === 0) {
    parts.push("no duplicate-looking orders flagged");
  } else {
    parts.push(
      `${scan.flaggedOrders} ${plural(scan.flaggedOrders, "order")} flagged for review`
    );
  }

  let description = `${parts.join(" · ")}.`;

  if (scan.flaggedOrders > 0) {
    const confidenceParts: string[] = [];
    if (scan.strongerFindings > 0) {
      confidenceParts.push(
        `${scan.strongerFindings} stronger ${plural(scan.strongerFindings, "match", "matches")} (90–100%)`
      );
    }
    if (scan.reviewFindings > 0) {
      confidenceParts.push(`${scan.reviewFindings} need review (70–89%)`);
    }
    if (confidenceParts.length > 0) {
      description += ` ${confidenceParts.join(" · ")}.`;
    }
    description += " Review each flagged order before taking action.";
  }

  description += scan.candidateCapExceeded
    ? " High-volume periods were partially checked; review the available results."
    : "";

  return description;
}
