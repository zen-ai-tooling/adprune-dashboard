export type B1SuggestionKind = "pause" | "cut_bid" | "monitor" | "keep";

export interface B1Suggestion {
  kind: B1SuggestionKind;
  label: string;
  bg: string;
  color: string;
  border: string;
  rationale: string;
  defaultDecision: string;
}

interface B1SuggestionInput {
  clicks: number;
  spend: number;
  sales: number;
  orders?: number;
  acos?: number;
}

export function suggestB1Row(row: B1SuggestionInput): B1Suggestion {
  const clicks = row.clicks ?? 0;
  const spend = row.spend ?? 0;
  const sales = row.sales ?? 0;
  const orders = row.orders ?? 0;
  const hasConversions = sales > 0 || orders > 0;
  const acosNum = row.acos != null ? row.acos : sales > 0 ? (spend / sales) * 100 : 0;

  if (hasConversions) {
    // Even with some conversions, this target was flagged as a bleeder.
    // The ACoS is likely very high or the conversions are marginal.
    if (acosNum >= 200) {
      return {
        kind: "pause",
        label: "Pause",
        bg: "rgba(239, 68, 68, 0.08)",
        color: "#B91C1C",
        border: "rgba(239, 68, 68, 0.22)",
        rationale: `${orders} order(s) but ${acosNum.toFixed(0)}% ACoS on $${spend.toFixed(2)} — losing money despite conversions`,
        defaultDecision: "Pause",
      };
    }
    if (acosNum >= 100) {
      return {
        kind: "cut_bid",
        label: "Cut Bid",
        bg: "rgba(245, 158, 11, 0.08)",
        color: "#B45309",
        border: "rgba(245, 158, 11, 0.22)",
        rationale: `${orders} order(s) at ${acosNum.toFixed(0)}% ACoS — unprofitable, cut bid`,
        defaultDecision: "Cut Bid 50%",
      };
    }
    if (acosNum >= 50 && spend >= 15) {
      return {
        kind: "monitor",
        label: "Review",
        bg: "rgba(107, 114, 128, 0.07)",
        color: "#374151",
        border: "rgba(107, 114, 128, 0.20)",
        rationale: `${orders} order(s) at ${acosNum.toFixed(0)}% ACoS — converting but may need bid adjustment`,
        defaultDecision: "Keep",
      };
    }
    return {
      kind: "keep",
      label: "Keep",
      bg: "rgba(5, 150, 105, 0.08)",
      color: "#047857",
      border: "rgba(5, 150, 105, 0.20)",
      rationale: `${orders} order(s) at reasonable ACoS — keep and monitor`,
      defaultDecision: "Keep",
    };
  }

  if (spend >= 30 && clicks >= 20) {
    return {
      kind: "pause",
      label: "Pause",
      bg: "rgba(239, 68, 68, 0.08)",
      color: "#B91C1C",
      border: "rgba(239, 68, 68, 0.22)",
      rationale: `${clicks} clicks, $${spend.toFixed(2)} spend, zero conversions — strong pause candidate`,
      defaultDecision: "Pause",
    };
  }
  if (clicks >= 30) {
    return {
      kind: "pause",
      label: "Pause",
      bg: "rgba(239, 68, 68, 0.08)",
      color: "#B91C1C",
      border: "rgba(239, 68, 68, 0.22)",
      rationale: `${clicks} clicks with zero conversions — pause recommended`,
      defaultDecision: "Pause",
    };
  }
  if (spend >= 15 && clicks >= 13) {
    return {
      kind: "cut_bid",
      label: "Cut Bid",
      bg: "rgba(245, 158, 11, 0.08)",
      color: "#B45309",
      border: "rgba(245, 158, 11, 0.22)",
      rationale: `${clicks} clicks, $${spend.toFixed(2)} spend — reduce bid before pausing`,
      defaultDecision: "Cut Bid 50%",
    };
  }
  if (spend >= 25 && clicks >= 8) {
    return {
      kind: "cut_bid",
      label: "Cut Bid",
      bg: "rgba(245, 158, 11, 0.08)",
      color: "#B45309",
      border: "rgba(245, 158, 11, 0.22)",
      rationale: `$${spend.toFixed(2)} spend with zero sales — cut bid to reduce cost`,
      defaultDecision: "Cut Bid 50%",
    };
  }
  if (clicks >= 10 || spend >= 8) {
    return {
      kind: "monitor",
      label: "Monitor",
      bg: "rgba(107, 114, 128, 0.07)",
      color: "#374151",
      border: "rgba(107, 114, 128, 0.20)",
      rationale: `${clicks} clicks — not enough data yet, monitor before acting`,
      defaultDecision: "Keep",
    };
  }
  return {
    kind: "keep",
    label: "Keep",
    bg: "rgba(5, 150, 105, 0.06)",
    color: "#047857",
    border: "rgba(5, 150, 105, 0.18)",
    rationale: "Low spend and clicks — keep and let data accumulate",
    defaultDecision: "Keep",
  };
}
