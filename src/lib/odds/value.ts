import { computeStakeUnits, expectedValuePerUnitStake } from "./stake-units";

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
  stakeUnits: number;
  rating: number;
  ratingLabel: string;
}

export interface ValuePolicy {
  minEdge: number;
  minExpectedValue: number;
  minModelConfidence: number;
  minModelProb: number;
  minOdds: number;
  maxKellyFraction: number;
}

export type ValueRejectionReason =
  | "odds_not_positive"
  | "edge_below_min"
  | "expected_value_below_min"
  | "confidence_below_min"
  | "model_prob_below_min"
  | "odds_below_min"
  | "portfolio_not_best_1x2";

export interface ValueCheckResult {
  qualifies: boolean;
  reasons: ValueRejectionReason[];
  metrics: {
    market: string;
    modelProb: number;
    modelConfidence: number;
    bestOdds: number;
    impliedProb: number;
    rawImpliedProb: number;
    edge: number;
    edgePct: number;
    expectedValue: number;
    kellyRaw: number;
    kellyFraction: number;
    quarterKelly: number;
    halfKelly: number;
  };
  draft: ValuePickDraft | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DEFAULT_VALUE_POLICY: ValuePolicy = {
  minEdge: readEnvNumber("VALUE_MIN_EDGE", 0.03),
  minExpectedValue: readEnvNumber("VALUE_MIN_EV", 0),
  minModelConfidence: readEnvNumber("VALUE_MIN_CONFIDENCE", 0.35),
  minModelProb: readEnvNumber("VALUE_MIN_MODEL_PROB", 0.15),
  minOdds: readEnvNumber("VALUE_MIN_ODDS", 1.2),
  maxKellyFraction: readEnvNumber("VALUE_MAX_KELLY", 0.1),
};

export const VALUE_REJECTION_REASON_LABELS: Record<ValueRejectionReason, string> = {
  odds_not_positive: "Invalid odds",
  edge_below_min: "Edge below threshold",
  expected_value_below_min: "Expected value below threshold",
  confidence_below_min: "Confidence below threshold",
  model_prob_below_min: "Model probability below threshold",
  odds_below_min: "Odds below threshold",
  portfolio_not_best_1x2: "Another 1X2 outcome is the stronger fixture-level pick",
};

function computeRating(edge: number, confidence: number): number {
  let rating = 1;
  if (edge > 0.05 && confidence > 0.55) rating = 2;
  if (edge > 0.07 && confidence > 0.65) rating = 3;
  if (edge > 0.1 && confidence > 0.7) rating = 4;
  if (edge > 0.12 && confidence > 0.75) rating = 5;
  return rating;
}

export function evaluateValue(
  input: ValueCheckInput,
  policy: ValuePolicy = DEFAULT_VALUE_POLICY,
): ValueCheckResult {
  const edge = input.modelProb - input.impliedProb;
  const rawImpliedProb = input.bestOdds > 0 ? 1 / input.bestOdds : 0;
  const expectedValue = expectedValuePerUnitStake(input.modelProb, input.bestOdds);
  const denom = input.bestOdds - 1;
  const kellyRaw = denom > 0 ? expectedValue / denom : 0;
  const kellyFraction = Math.max(0, Math.min(policy.maxKellyFraction, kellyRaw));
  const reasons: ValueRejectionReason[] = [];

  if (input.bestOdds <= 0) reasons.push("odds_not_positive");
  if (edge < policy.minEdge) reasons.push("edge_below_min");
  if (expectedValue < policy.minExpectedValue) reasons.push("expected_value_below_min");
  if (input.modelConfidence < policy.minModelConfidence) {
    reasons.push("confidence_below_min");
  }
  if (input.modelProb < policy.minModelProb) reasons.push("model_prob_below_min");
  if (input.bestOdds < policy.minOdds) reasons.push("odds_below_min");

  const rating = computeRating(edge, input.modelConfidence);
  const ratingLabels = [
    "",
    "speculative",
    "moderate",
    "strong",
    "very_strong",
    "max_conviction",
  ];

  const metrics = {
    market: input.market,
    modelProb: input.modelProb,
    modelConfidence: input.modelConfidence,
    bestOdds: input.bestOdds,
    impliedProb: input.impliedProb,
    rawImpliedProb,
    edge: round2(edge),
    edgePct: round2(edge * 100),
    expectedValue,
    kellyRaw,
    kellyFraction,
    quarterKelly: kellyFraction * 0.25,
    halfKelly: kellyFraction * 0.5,
  };

  const draft: ValuePickDraft | null =
    reasons.length > 0
      ? null
      : {
          market: input.market,
          modelProb: input.modelProb,
          modelConfidence: input.modelConfidence,
          bestOdds: input.bestOdds,
          bestBookmaker: "",
          impliedProb: input.impliedProb,
          edge: metrics.edge,
          edgePct: metrics.edgePct,
          kellyFraction: metrics.kellyFraction,
          quarterKelly: metrics.quarterKelly,
          halfKelly: metrics.halfKelly,
          stakeUnits: computeStakeUnits({
            rating,
            modelProb: input.modelProb,
            bestOdds: input.bestOdds,
          }),
          rating,
          ratingLabel: ratingLabels[rating] ?? "speculative",
        };

  return {
    qualifies: reasons.length === 0,
    reasons,
    metrics,
    draft,
  };
}

export function checkValue(
  input: ValueCheckInput,
  policy: ValuePolicy = DEFAULT_VALUE_POLICY,
): ValuePickDraft | null {
  return evaluateValue(input, policy).draft;
}
