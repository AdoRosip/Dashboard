import type { PredictionResult } from "../prediction/engine";
import { MVP_PRODUCTION_VALUE_MARKETS } from "../mvp/config";

export const SUPPORTED_VALUE_MARKETS = MVP_PRODUCTION_VALUE_MARKETS;

export type SupportedValueMarket = (typeof SUPPORTED_VALUE_MARKETS)[number];

type OddsSnapshotLike = {
  market: string;
  bookmaker: string;
  outcome1: number;
  outcome2: number;
  outcome3: number | null;
  impliedProb1: number;
  impliedProb2: number;
  impliedProb3: number | null;
};

export interface ValueMarketCandidate {
  market: SupportedValueMarket;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  bestBookmaker: string;
  impliedProb: number;
  rawImpliedProb: number;
}

function bestByOdds<T extends { odds: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.odds > best.odds ? row : best), rows[0]!);
}

export function buildValueMarketCandidates(
  prediction: Pick<
    PredictionResult,
    "probHomeWin" | "probDraw" | "probAwayWin" | "probOver25" | "modelConfidence"
  >,
  snapshots: OddsSnapshotLike[],
): ValueMarketCandidate[] {
  const byMarket = new Map<string, OddsSnapshotLike[]>();
  for (const snapshot of snapshots) {
    const list = byMarket.get(snapshot.market) ?? [];
    list.push(snapshot);
    byMarket.set(snapshot.market, list);
  }

  const candidates: ValueMarketCandidate[] = [];
  const markets: Array<{
    key: SupportedValueMarket;
    modelProb: number;
    pickOutcome: "1" | "2" | "3";
  }> = [
    { key: "1x2_home", modelProb: prediction.probHomeWin, pickOutcome: "1" },
    { key: "1x2_draw", modelProb: prediction.probDraw, pickOutcome: "2" },
    { key: "1x2_away", modelProb: prediction.probAwayWin, pickOutcome: "3" },
  ];

  for (const market of markets) {
    if (market.key.startsWith("1x2")) {
      const rows = (byMarket.get("1x2") ?? []).map((snapshot) => {
        const odds =
          market.pickOutcome === "1"
            ? snapshot.outcome1
            : market.pickOutcome === "2"
              ? snapshot.outcome2
              : snapshot.outcome3 ?? snapshot.outcome2;
        const implied =
          market.pickOutcome === "1"
            ? snapshot.impliedProb1
            : market.pickOutcome === "2"
              ? snapshot.impliedProb2
              : snapshot.impliedProb3 ?? snapshot.impliedProb2;
        return {
          bookmaker: snapshot.bookmaker,
          odds,
          implied,
        };
      });
      const best = bestByOdds(rows);
      if (!best || best.odds <= 0) continue;

      candidates.push({
        market: market.key,
        modelProb: market.modelProb,
        modelConfidence: prediction.modelConfidence,
        bestOdds: best.odds,
        bestBookmaker: best.bookmaker,
        impliedProb: best.implied,
        rawImpliedProb: 1 / best.odds,
      });
      continue;
    }

  }

  return candidates;
}
