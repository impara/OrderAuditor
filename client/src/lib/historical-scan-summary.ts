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

function formatList(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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
    if (scan.matchesFound > 0) {
      parts.push(
        `${scan.matchesFound} duplicate-looking ${plural(scan.matchesFound, "group")}`
      );
    }
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
    if (scan.signals.length > 0) {
      description += ` Signals found: ${formatList(scan.signals)}.`;
    }
    description +=
      " These are review signals, not automatic decisions. Review each flagged order before taking action.";
  }

  description +=
    " Duplicate Guard compares order details such as email, phone, address, name, and SKU.";

  description += scan.candidateCapExceeded
    ? " High-volume periods were partially checked. Review the available results while live monitoring continues."
    : " Future new orders continue to be checked normally.";

  return description;
}
