import { prisma } from "../db";

/**
 * Recompute aggregate betting performance from settled ValuePicks.
 */
export async function recomputeBettingPerformance(): Promise<void> {
  const settled = await prisma.valuePick.findMany({
    where: { settled: true, profitLoss: { not: null } },
  });

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
    const stake = p.quarterKelly;
    totalStaked += stake;
    totalReturn += stake + (p.profitLoss ?? 0);
    if (p.outcome === "win") wins++;
    else if (p.outcome === "loss") losses++;
    if (p.closingLineValue != null) {
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
    },
  });
}
