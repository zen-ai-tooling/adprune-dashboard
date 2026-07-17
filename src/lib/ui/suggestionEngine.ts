export type SuggestionDecision = "Negative" | "Pause" | "Cut Bid" | "Keep";

export type SuggestionConfidence = "high" | "medium" | "low";

export interface Suggestion {
  decision: SuggestionDecision;
  confidence: SuggestionConfidence;
  reason: string;
  shortLabel: string;
}

interface BleederInput {
  acos: number;
  spend: number;
  orders: number;
  clicks?: number;
  matchType?: string;
  entity?: string;
  trackType: string;
  thresholdAcos?: number; // The computed ACoS threshold for this track (e.g., 50 for SB/SD, 60 for SP)
}

export function suggestDecision(bleeder: BleederInput): Suggestion {
  const entity = bleeder.entity?.toLowerCase() ?? "";
  const isProductTargeting =
    entity.includes("asin=") ||
    entity.includes("category=") ||
    entity.includes("close-match") ||
    entity.includes("loose-match") ||
    entity.includes("substitutes") ||
    entity.includes("complements");

  // ACOS100 track — campaign level decisions
  if (bleeder.trackType === "ACOS100") {
    if (bleeder.acos >= 300) {
      return {
        decision: "Pause",
        confidence: "high",
        reason: `ACoS ${bleeder.acos.toFixed(0)}% — extremely unprofitable`,
        shortLabel: "Pause",
      };
    }
    if (bleeder.acos >= 150) {
      return {
        decision: "Cut Bid",
        confidence: "high",
        reason: `ACoS ${bleeder.acos.toFixed(0)}% — cut bids before pausing`,
        shortLabel: "Cut bid",
      };
    }
    return {
      decision: "Cut Bid",
      confidence: "medium",
      reason: `ACoS ${bleeder.acos.toFixed(0)}% — borderline, try bid reduction`,
      shortLabel: "Cut bid?",
    };
  }

  // Threshold-relative logic — use when caller supplies a track threshold AND we have orders (ACoS is meaningful)
  if (bleeder.thresholdAcos && bleeder.thresholdAcos > 0 && bleeder.orders > 0) {
    const threshold = bleeder.thresholdAcos;
    const acos = bleeder.acos;
    const acosStr = acos.toFixed(1);
    const thrStr = threshold.toFixed(0);
    const ratio = (acos / threshold).toFixed(1);

    if (acos >= 3 * threshold) {
      return {
        decision: "Negative",
        confidence: "high",
        reason: `ACoS ${acosStr}% is 3× your ${thrStr}% threshold — clear negative`,
        shortLabel: "Negative",
      };
    }
    if (acos >= 2 * threshold) {
      return {
        decision: "Negative",
        confidence: "medium",
        reason: `ACoS ${acosStr}% is ${ratio}× your ${thrStr}% threshold — strong negative candidate`,
        shortLabel: "Negative",
      };
    }
    if (acos >= 1.5 * threshold) {
      return {
        decision: "Cut Bid",
        confidence: "medium",
        reason: `ACoS ${acosStr}% is ${ratio}× your ${thrStr}% threshold — reduce bid`,
        shortLabel: "Cut bid",
      };
    }
    if (acos >= threshold) {
      return {
        decision: "Cut Bid",
        confidence: "low",
        reason: `ACoS ${acosStr}% is above your ${thrStr}% threshold — try bid reduction`,
        shortLabel: "Cut bid?",
      };
    }
    return {
      decision: "Keep",
      confidence: "low",
      reason: `ACoS ${acosStr}% is under your ${thrStr}% threshold — monitor`,
      shortLabel: "Keep",
    };
  }

  // Zero orders + significant spend — strong negative signal
  if (bleeder.orders === 0 && bleeder.spend >= 25) {
    return {
      decision: "Negative",
      confidence: "high",
      reason: `$${bleeder.spend.toFixed(2)} spent, 0 orders — clear waste`,
      shortLabel: "Negative",
    };
  }

  // Zero orders + low spend — pause first, don't over-react
  if (bleeder.orders === 0 && bleeder.spend < 25 && bleeder.spend >= 5) {
    return {
      decision: "Pause",
      confidence: "medium",
      reason: `0 orders, $${bleeder.spend.toFixed(2)} spend — pause and monitor`,
      shortLabel: "Pause?",
    };
  }

  // Very high ACoS with product targeting — negative
  if (bleeder.acos >= 200 && isProductTargeting) {
    return {
      decision: "Negative",
      confidence: "high",
      reason: `ACoS ${bleeder.acos.toFixed(0)}% on product target — negate`,
      shortLabel: "Negative",
    };
  }

  // Very high ACoS on keyword
  if (bleeder.acos >= 200) {
    return {
      decision: "Negative",
      confidence: "high",
      reason: `ACoS ${bleeder.acos.toFixed(0)}% — well above threshold`,
      shortLabel: "Negative",
    };
  }

  // High ACoS — cut bid first
  if (bleeder.acos >= 100) {
    return {
      decision: "Cut Bid",
      confidence: "medium",
      reason: `ACoS ${bleeder.acos.toFixed(0)}% — reduce bid before negating`,
      shortLabel: "Cut bid",
    };
  }

  // Borderline — low orders but not zero
  if (bleeder.orders <= 3 && bleeder.acos >= 70 && bleeder.spend >= 15) {
    return {
      decision: "Cut Bid",
      confidence: "low",
      reason: `${bleeder.orders} order(s), $${bleeder.spend.toFixed(2)} spend — review`,
      shortLabel: "Cut bid",
    };
  }

  // Default — keep and watch
  return {
    decision: "Keep",
    confidence: "low",
    reason: "Borderline performance — keep and monitor",
    shortLabel: "Keep?",
  };
}

export function getConfidenceStyle(confidence: SuggestionConfidence): {
  background: string;
  color: string;
  border: string;
} {
  switch (confidence) {
    case "high":
      return { background: "#F0FDF4", color: "#10B981", border: "#BBF7D0" };
    case "medium":
      return { background: "#FFFBEB", color: "#D97706", border: "#FDE68A" };
    case "low":
      return { background: "#F9FAFB", color: "#9BA3AF", border: "#E4E6EA" };
  }
}
