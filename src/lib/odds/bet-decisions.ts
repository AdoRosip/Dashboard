import { prisma } from "../db";

type LegacyValuePickSnapshot = {
  id: number;
  fixtureId: number;
  market: string;
  flaggedAt: Date;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  bestBookmaker: string;
  impliedProb: number;
  edge: number;
  edgePct: number;
  kellyFraction: number;
  stakeUnits: number | null;
  rating: number;
  ratingLabel: string;
  outcome: string | null;
  profitLoss: number | null;
  settled: boolean;
  settledAt: Date | null;
  closingOdds: number | null;
  closingImplied: number | null;
  closingLineValue: number | null;
  closingLineSnapshotKind: string | null;
};

export async function backfillBetDecisionsFromValuePicks(): Promise<number> {
  const legacy = (await prisma.valuePick.findMany({
    orderBy: { flaggedAt: "asc" },
  })) as LegacyValuePickSnapshot[];

  let created = 0;
  for (const pick of legacy) {
    const existing = await prisma.betDecision.findFirst({
      where: { fixtureId: pick.fixtureId, market: pick.market },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.betDecision.create({
      data: {
        fixtureId: pick.fixtureId,
        market: pick.market,
        source: "legacy_value_pick",
        modelVersion: "legacy_value_pick",
        policyJson: "{}",
        bestBookmaker: pick.bestBookmaker,
        modelProb: pick.modelProb,
        modelConfidence: pick.modelConfidence,
        bestOdds: pick.bestOdds,
        rawImpliedProb: pick.bestOdds > 0 ? 1 / pick.bestOdds : 0,
        impliedProb: pick.impliedProb,
        edge: pick.edge,
        edgePct: pick.edgePct,
        expectedValue: pick.modelProb * pick.bestOdds - 1,
        kellyFraction: pick.kellyFraction,
        stakeUnits: pick.stakeUnits,
        rating: pick.rating,
        ratingLabel: pick.ratingLabel,
        decidedAt: pick.flaggedAt,
        closingOdds: pick.closingOdds,
        closingImplied: pick.closingImplied,
        closingLineValue: pick.closingLineValue,
        closingLineSnapshotKind: pick.closingLineSnapshotKind,
        outcome: pick.outcome,
        profitLoss: pick.profitLoss,
        settled: pick.settled,
        settledAt: pick.settledAt,
      },
    });
    created++;
  }

  return created;
}

export async function createBetDecisionFromAcceptedCandidate(params: {
  candidateId: number;
  fixtureId: number;
  market: string;
  modelVersion: string;
  policyJson: string;
  bestBookmaker: string;
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  rawImpliedProb: number;
  impliedProb: number;
  edge: number;
  edgePct: number;
  expectedValue: number;
  kellyFraction: number;
  stakeUnits: number | null;
  rating: number | null;
  ratingLabel: string | null;
}): Promise<boolean> {
  const existing = await prisma.betDecision.findFirst({
    where: { fixtureId: params.fixtureId, market: params.market },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.betDecision.create({
    data: {
      candidateId: params.candidateId,
      fixtureId: params.fixtureId,
      market: params.market,
      source: "accepted_candidate",
      modelVersion: params.modelVersion,
      policyJson: params.policyJson,
      bestBookmaker: params.bestBookmaker,
      modelProb: params.modelProb,
      modelConfidence: params.modelConfidence,
      bestOdds: params.bestOdds,
      rawImpliedProb: params.rawImpliedProb,
      impliedProb: params.impliedProb,
      edge: params.edge,
      edgePct: params.edgePct,
      expectedValue: params.expectedValue,
      kellyFraction: params.kellyFraction,
      stakeUnits: params.stakeUnits,
      rating: params.rating,
      ratingLabel: params.ratingLabel,
    },
  });
  return true;
}

export async function getBetDecisionHistory(
  limit = 100,
  filters?: {
    markets?: string[];
    competitionIds?: string[];
  },
) {
  const [summary, recent] = await Promise.all([
    prisma.betDecision.aggregate({
      _count: { _all: true },
      where: {
        ...(filters?.markets ? { market: { in: filters.markets } } : {}),
        ...(filters?.competitionIds
          ? { fixture: { competitionId: { in: filters.competitionIds } } }
          : {}),
      },
    }),
    prisma.betDecision.findMany({
      orderBy: { decidedAt: "desc" },
      take: limit,
      where: {
        ...(filters?.markets ? { market: { in: filters.markets } } : {}),
        ...(filters?.competitionIds
          ? { fixture: { competitionId: { in: filters.competitionIds } } }
          : {}),
      },
      include: {
        fixture: {
          include: {
            competition: { select: { id: true, name: true } },
            homeTeam: { select: { name: true, shortName: true } },
            awayTeam: { select: { name: true, shortName: true } },
          },
        },
      },
    }),
  ]);

  const open = recent.filter((row) => !row.settled).length;
  const settled = recent.filter((row) => row.settled).length;

  return {
    total: summary._count._all,
    open,
    settled,
    recent: recent.map((row) => ({
      id: row.id,
      fixtureId: row.fixtureId,
      market: row.market,
      source: row.source,
      modelVersion: row.modelVersion,
      decidedAt: row.decidedAt,
      settled: row.settled,
      settledAt: row.settledAt,
      outcome: row.outcome,
      profitLoss: row.profitLoss,
      edgePct: row.edgePct,
      expectedValuePct: row.expectedValue * 100,
      confidencePct: row.modelConfidence * 100,
      bestOdds: row.bestOdds,
      bestBookmaker: row.bestBookmaker,
      competitionId: row.fixture.competition.id,
      competition: row.fixture.competition.name,
      homeTeam: row.fixture.homeTeam.shortName ?? row.fixture.homeTeam.name,
      awayTeam: row.fixture.awayTeam.shortName ?? row.fixture.awayTeam.name,
    })),
  };
}
