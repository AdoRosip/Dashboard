import { prisma } from "../db";
import {
  resolveProfitLossForAggregate,
  resolveStakeForSettlement,
} from "../odds/stake-units";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "./config";

type SettledDecisionRow = {
  id: number;
  fixtureId: number;
  market: string;
  outcome: string | null;
  modelProb: number;
  bestOdds: number;
  profitLoss: number | null;
  settledAt: Date | null;
  stakeUnits: number | null;
  rating: number | null;
  closingLineValue: number | null;
  closingLineSnapshotKind: string | null;
  fixture: {
    competitionId: string;
    competition: { name: string };
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
    scoreHomeFt: number | null;
    scoreAwayFt: number | null;
  };
};

type ResultAggregate = {
  picks: number;
  wins: number;
  losses: number;
  voids: number;
  totalStaked: number;
  profitLoss: number;
  roi: number;
  hitRate: number;
  avgOdds: number;
  avgClosingLineValue: number | null;
  closingLineSampleSize: number;
};

function emptyAggregate(): ResultAggregate {
  return {
    picks: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    totalStaked: 0,
    profitLoss: 0,
    roi: 0,
    hitRate: 0,
    avgOdds: 0,
    avgClosingLineValue: null,
    closingLineSampleSize: 0,
  };
}

function aggregateSettled(rows: SettledDecisionRow[]): ResultAggregate {
  if (rows.length === 0) return emptyAggregate();

  let wins = 0;
  let losses = 0;
  let voids = 0;
  let totalStaked = 0;
  let profitLoss = 0;
  let oddsSum = 0;
  let clvSum = 0;
  let clvN = 0;

  for (const row of rows) {
    const stake = resolveStakeForSettlement({
      stakeUnits: row.stakeUnits,
      rating: row.rating ?? 1,
      modelProb: row.modelProb,
      bestOdds: row.bestOdds,
    });
    const pl = resolveProfitLossForAggregate({
      stakeUnits: row.stakeUnits,
      quarterKelly: 0,
      profitLoss: row.profitLoss,
      outcome: row.outcome,
      bestOdds: row.bestOdds,
      rating: row.rating ?? 1,
      modelProb: row.modelProb,
    });

    totalStaked += stake;
    profitLoss += pl;
    oddsSum += row.bestOdds;

    if (row.outcome === "win") wins++;
    else if (row.outcome === "loss") losses++;
    else if (row.outcome === "void" || row.outcome === "push") voids++;

    if (row.closingLineValue != null && row.closingLineSnapshotKind === "closing") {
      clvSum += row.closingLineValue;
      clvN++;
    }
  }

  return {
    picks: rows.length,
    wins,
    losses,
    voids,
    totalStaked,
    profitLoss,
    roi: totalStaked > 0 ? (profitLoss / totalStaked) * 100 : 0,
    hitRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    avgOdds: oddsSum / rows.length,
    avgClosingLineValue: clvN > 0 ? clvSum / clvN : null,
    closingLineSampleSize: clvN,
  };
}

export async function buildMvpResultsReport() {
  const settled = (await prisma.betDecision.findMany({
    where: {
      settled: true,
      profitLoss: { not: null },
      market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
      fixture: { competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] } },
    },
    orderBy: { settledAt: "desc" },
    include: {
      fixture: {
        include: {
          competition: { select: { name: true } },
          homeTeam: { select: { name: true, shortName: true } },
          awayTeam: { select: { name: true, shortName: true } },
        },
      },
    },
  })) as SettledDecisionRow[];

  const byMarket = MVP_PRODUCTION_VALUE_MARKETS.map((market) => ({
    market,
    ...aggregateSettled(settled.filter((row) => row.market === market)),
  }));

  const byLeague = [...new Set(settled.map((row) => row.fixture.competitionId))]
    .sort()
    .map((league) => {
      const rows = settled.filter((row) => row.fixture.competitionId === league);
      return {
        league,
        competition: rows[0]?.fixture.competition.name ?? league,
        ...aggregateSettled(rows),
      };
    });

  const monthKeys = [...new Set(
    settled
      .map((row) => row.settledAt)
      .filter((value): value is Date => value instanceof Date)
      .map((date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`),
  )]
    .sort()
    .reverse();

  const byMonth = monthKeys.map((month) => {
    const rows = settled.filter((row) => {
      if (!row.settledAt) return false;
      const key = `${row.settledAt.getUTCFullYear()}-${String(row.settledAt.getUTCMonth() + 1).padStart(2, "0")}`;
      return key === month;
    });
    return {
      month,
      ...aggregateSettled(rows),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      competitions: [...MVP_SUPPORTED_COMPETITION_CODES],
      markets: [...MVP_PRODUCTION_VALUE_MARKETS],
    },
    overall: aggregateSettled(settled),
    byMarket,
    byLeague,
    byMonth,
    recentSettled: settled.slice(0, 40).map((row) => ({
      id: row.id,
      fixtureId: row.fixtureId,
      market: row.market,
      outcome: row.outcome,
      modelProb: row.modelProb,
      bestOdds: row.bestOdds,
      profitLoss: row.profitLoss,
      settledAt: row.settledAt,
      competition: row.fixture.competition.name,
      homeTeam: row.fixture.homeTeam.shortName ?? row.fixture.homeTeam.name,
      awayTeam: row.fixture.awayTeam.shortName ?? row.fixture.awayTeam.name,
      score:
        row.fixture.scoreHomeFt != null && row.fixture.scoreAwayFt != null
          ? `${row.fixture.scoreHomeFt}-${row.fixture.scoreAwayFt}`
          : "—",
    })),
  };
}
