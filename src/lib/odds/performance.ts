import { prisma } from "../db";
import {
  resolveProfitLossForAggregate,
  resolveStakeForSettlement,
} from "./stake-units";

type SettledBetDecision = {
  outcome: string | null;
  stakeUnits: number | null;
  rating: number | null;
  modelProb: number;
  bestOdds: number;
  profitLoss: number | null;
  closingLineValue: number | null;
  closingLineSnapshotKind?: string | null;
};

/**
 * Recompute aggregate betting performance from immutable BetDecisions.
 */
export async function recomputeBettingPerformance(): Promise<void> {
  const settled = await prisma.betDecision.findMany({
    where: { settled: true, profitLoss: { not: null } },
  }) as SettledBetDecision[];

  let totalStaked = 0;
  let totalReturn = 0;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let clvSum = 0;
  let clvN = 0;

  for (const p of settled) {
    if (p.outcome === "void" || p.outcome === "push") {
      voids++;
      continue;
    }
    const stake = resolveStakeForSettlement({
      stakeUnits: p.stakeUnits,
      rating: p.rating ?? 1,
      modelProb: p.modelProb,
      bestOdds: p.bestOdds,
    });
    const pl = resolveProfitLossForAggregate({
      stakeUnits: p.stakeUnits,
      quarterKelly: 0,
      profitLoss: p.profitLoss,
      outcome: p.outcome,
      bestOdds: p.bestOdds,
      rating: p.rating ?? 1,
      modelProb: p.modelProb,
    });
    totalStaked += stake;
    totalReturn += stake + pl;
    if (p.outcome === "win") wins++;
    else if (p.outcome === "loss") losses++;
    if (
      p.closingLineValue != null &&
      p.closingLineSnapshotKind === "closing"
    ) {
      clvSum += p.closingLineValue;
      clvN++;
    }
  }

  const profitLoss = totalReturn - totalStaked;
  const roi = totalStaked > 0 ? (profitLoss / totalStaked) * 100 : 0;
  const hitRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const avgClv = clvN > 0 ? clvSum / clvN : 0;

  await prisma.bettingPerformance.upsert({
    where: {
      period_market_league: { period: "all_time", market: "all", league: "all" },
    },
    create: {
      period: "all_time",
      market: "all",
      league: "all",
      totalPicks: settled.length,
      wins,
      losses,
      voids,
      totalStaked,
      totalReturn,
      profitLoss,
      roi,
      avgClosingLineValue: avgClv,
      hitRate,
      updatedAt: new Date(),
    },
    update: {
      totalPicks: settled.length,
      wins,
      losses,
      voids,
      totalStaked,
      totalReturn,
      profitLoss,
      roi,
      avgClosingLineValue: avgClv,
      hitRate,
      updatedAt: new Date(),
    },
  });
}
