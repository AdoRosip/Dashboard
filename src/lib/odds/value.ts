export interface ValueCheckInput {
  market: string;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  impliedProb: number;
}

export interface ValuePickDraft {
  market: string;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  bestBookmaker: string;
  impliedProb: number;
  edge: number;
  edgePct: number;
  kellyFraction: number;
  quarterKelly: number;
  halfKelly: number;
  rating: number;
  ratingLabel: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function checkValue(input: ValueCheckInput): ValuePickDraft | null {
  const edge = input.modelProb - input.impliedProb;

  if (edge < 0.03) return null;
  if (input.modelConfidence < 0.45) return null;
  if (input.modelProb < 0.15) return null;
  if (input.bestOdds < 1.2) return null;

  const denom = input.bestOdds - 1;
  /** Full Kelly fraction of bankroll: (p·O − 1) / (O − 1) for decimal odds O. */
  const kellyRaw =
    denom > 0
      ? (input.modelProb * input.bestOdds - 1) / denom
      : 0;
  const clampedKelly = Math.max(0, Math.min(0.1, kellyRaw));

  let rating = 1;
  if (edge > 0.05 && input.modelConfidence > 0.55) rating = 2;
  if (edge > 0.07 && input.modelConfidence > 0.65) rating = 3;
  if (edge > 0.1 && input.modelConfidence > 0.7) rating = 4;
  if (edge > 0.12 && input.modelConfidence > 0.75) rating = 5;

  const ratingLabels = [
    "",
    "speculative",
    "moderate",
    "strong",
    "very_strong",
    "max_conviction",
  ];

  return {
    market: input.market,
    modelProb: input.modelProb,
    modelConfidence: input.modelConfidence,
    bestOdds: input.bestOdds,
    bestBookmaker: "",
    impliedProb: input.impliedProb,
    edge: round2(edge),
    edgePct: round2(edge * 100),
    kellyFraction: round2(clampedKelly),
    quarterKelly: round2(clampedKelly * 0.25),
    halfKelly: round2(clampedKelly * 0.5),
    rating,
    ratingLabel: ratingLabels[rating] ?? "speculative",
  };
}
