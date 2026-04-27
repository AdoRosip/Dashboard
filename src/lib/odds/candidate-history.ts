import { prisma } from "../db";

type CandidateRow = {
  id: number;
  market: string;
  accepted: boolean;
  rejectionReasons: string;
  edgePct: number;
  expectedValue: number;
  modelConfidence: number;
  bestOdds: number;
  bestBookmaker: string;
  evaluatedAt: Date;
  fixture: {
    id: number;
    utcDate: Date;
    competition: { name: string };
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
  };
  run: {
    id: number;
    startedAt: Date;
    modelVersion: string;
  };
};

function parseReasons(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function teamLabel(team: { name: string; shortName: string | null }): string {
  return team.shortName ?? team.name;
}

export async function getCandidateHistory(limit = 100) {
  const [runs, rows] = await Promise.all([
    prisma.valuePickRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
    prisma.valuePickCandidate.findMany({
      orderBy: { evaluatedAt: "desc" },
      take: limit,
      include: {
        run: {
          select: { id: true, startedAt: true, modelVersion: true },
        },
        fixture: {
          include: {
            competition: { select: { name: true } },
            homeTeam: { select: { name: true, shortName: true } },
            awayTeam: { select: { name: true, shortName: true } },
          },
        },
      },
    }),
  ]);

  const rejectionCounts = new Map<string, number>();
  for (const row of rows as CandidateRow[]) {
    for (const reason of parseReasons(row.rejectionReasons)) {
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    runs: runs.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      daysAhead: run.daysAhead,
      modelVersion: run.modelVersion,
      fixturesConsidered: run.fixturesConsidered,
      acceptedCount: run.acceptedCount,
      rejectedCount: run.rejectedCount,
    })),
    summary: {
      accepted: rows.filter((row) => row.accepted).length,
      rejected: rows.filter((row) => !row.accepted).length,
      topRejections: Array.from(rejectionCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    recent: (rows as CandidateRow[]).map((row) => ({
      id: row.id,
      runId: row.run.id,
      evaluatedAt: row.evaluatedAt,
      fixtureId: row.fixture.id,
      kickoff: row.fixture.utcDate,
      competition: row.fixture.competition.name,
      homeTeam: teamLabel(row.fixture.homeTeam),
      awayTeam: teamLabel(row.fixture.awayTeam),
      market: row.market,
      accepted: row.accepted,
      rejectionReasons: parseReasons(row.rejectionReasons),
      edgePct: row.edgePct,
      expectedValuePct: row.expectedValue * 100,
      confidencePct: row.modelConfidence * 100,
      bestOdds: row.bestOdds,
      bestBookmaker: row.bestBookmaker,
      modelVersion: row.run.modelVersion,
    })),
  };
}
