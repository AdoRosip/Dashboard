import { computeStakeUnits } from "./stake-units";

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
  /** Discrete stake for settlement (see `computeStakeUnits`). */
  stakeUnits: number;
  rating: number;
  ratingLabel: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Kelly fractions can be <1% of bankroll; round2 was zeroing quarterKelly and P/L. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Must stay at or below the prediction engine’s practical ceiling when 1X2 is ~uniform
 * (`engine.ts`: confidence ≈ 0.38 × dataQuality + 0.62 × sharpness; sharpness → 0 for balanced
 * matches). A floor of 0.45 made **every** tight match fail this gate with no value picks.
 */
const MIN_MODEL_CONFIDENCE_FOR_VALUE = 0.35;

export function checkValue(input: ValueCheckInput): ValuePickDraft | null {
  const edge = input.modelProb - input.impliedProb;

  if (edge < 0.03) return null;
  if (input.modelConfidence < MIN_MODEL_CONFIDENCE_FOR_VALUE) return null;
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

  const stakeUnits = computeStakeUnits({
    rating,
    modelProb: input.modelProb,
    bestOdds: input.bestOdds,
  });

  return {
    market: input.market,
    modelProb: input.modelProb,
    modelConfidence: input.modelConfidence,
    bestOdds: input.bestOdds,
    bestBookmaker: "",
    impliedProb: input.impliedProb,
    edge: round2(edge),
    edgePct: round2(edge * 100),
    kellyFraction: round4(clampedKelly),
    quarterKelly: round4(clampedKelly * 0.25),
    halfKelly: round4(clampedKelly * 0.5),
    stakeUnits,
    rating,
    ratingLabel: ratingLabels[rating] ?? "speculative",
  };
}
