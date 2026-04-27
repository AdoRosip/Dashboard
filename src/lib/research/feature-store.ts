import { prisma } from "../db";
import { CURRENT_SEASON } from "../constants";
import {
  computeAttackingFeatures,
  computeContextFeatures,
  computeDefensiveFeatures,
  computeFormFeatures,
  computeH2HFeatures,
  computeSquadFeatures,
} from "../prediction/features";
import {
  DEFAULT_SNAPSHOT_TRUST,
  FEATURE_SOURCE_SNAPSHOT_SOURCES,
  type FeatureSourceSnapshotSource,
  LEGACY_FEATURE_BUILDER_LEAKAGE_WARNING,
  SNAPSHOT_TRUST_LEVELS,
  type SnapshotTrust,
  leakageWarningsJson,
} from "./snapshot-trust";

export const FEATURE_STORE_VERSION = "prematch_v1";

type FixtureForFeatureBuild = {
  id: number;
  competitionId: string;
  matchday: number | null;
  utcDate: Date;
  status: string;
  scoreHomeFt: number | null;
  scoreAwayFt: number | null;
  homeTeamId: number;
  awayTeamId: number;
  competition: { name: string; code: string };
  homeTeam: { name: string; shortName: string | null; competitionId: string | null };
  awayTeam: { name: string; shortName: string | null; competitionId: string | null };
};

type CurrentOddsSnapshot = {
  market: string;
  bookmaker: string;
  snapshotType: SnapshotType;
  impliedProb1: number;
  impliedProb2: number;
  impliedProb3: number | null;
  overround: number;
  observedAt: Date;
  outcome1?: number;
  outcome2?: number;
  outcome3?: number | null;
};

type SnapshotType = "opening" | "current" | "closing";
type FeatureSnapshotBuildMode = "legacy" | "forward";

export interface BuildFeatureSnapshotOptions {
  runId?: number;
  mode?: FeatureSnapshotBuildMode;
  capturedAt?: Date;
}

function seasonStatsCompetitionId(
  fixtureCompetitionId: string,
  teamCompetitionId: string | null,
): string {
  return new Set(["CL", "EC", "CLI"]).has(fixtureCompetitionId)
    ? (teamCompetitionId ?? fixtureCompetitionId)
    : fixtureCompetitionId;
}

function priorMatchWasEuropean(
  stats: Array<{ fixture?: { utcDate: Date; competitionId: string } | null }>,
  kickoff: Date,
): boolean {
  const row = stats[0];
  if (!row?.fixture) return false;
  const prev = new Date(row.fixture.utcDate);
  if (prev.getTime() >= kickoff.getTime()) return false;
  return new Set(["CL", "EC", "CLI"]).has(row.fixture.competitionId);
}

function compactTeamFeatures(
  parts: Array<Partial<Record<string, unknown>>>,
): Record<string, unknown> {
  return Object.assign({}, ...parts);
}

function safeDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function bestMarketLine(
  rows: CurrentOddsSnapshot[],
  market: "1x2_home" | "1x2_draw" | "1x2_away" | "over25" | "under25",
): {
  bookmaker: string;
  impliedProb: number;
  rawImpliedProb: number;
  odds: number;
} | null {
  if (market.startsWith("1x2")) {
    const ranked = rows
      .filter((row) => row.market === "1x2")
      .map((row) => {
        const odds =
          market === "1x2_home"
            ? row.outcome1 ?? 0
            : market === "1x2_draw"
              ? row.outcome2 ?? 0
              : row.outcome3 ?? 0;
        const implied =
          market === "1x2_home"
            ? row.impliedProb1
            : market === "1x2_draw"
              ? row.impliedProb2
              : row.impliedProb3 ?? 0;
        return {
          bookmaker: row.bookmaker,
          impliedProb: implied,
          rawImpliedProb: odds > 0 ? 1 / odds : 0,
          odds,
        };
      })
      .filter((row) => row.odds > 0);
    if (ranked.length === 0) return null;
    return ranked.reduce((best, row) => (row.odds > best.odds ? row : best), ranked[0]!);
  }

  const ranked = rows
    .filter((row) => row.market === "over_under_25")
    .map((row) => {
      const odds = market === "over25" ? row.outcome1 ?? 0 : row.outcome2 ?? 0;
      const implied = market === "over25" ? row.impliedProb1 : row.impliedProb2;
      return {
        bookmaker: row.bookmaker,
        impliedProb: implied,
        rawImpliedProb: odds > 0 ? 1 / odds : 0,
        odds,
      };
    })
    .filter((row) => row.odds > 0);
  if (ranked.length === 0) return null;
  return ranked.reduce((best, row) => (row.odds > best.odds ? row : best), ranked[0]!);
}

function summarizeSnapshotCoverage(
  rows: CurrentOddsSnapshot[],
): Record<
  SnapshotType,
  { rowCount: number; bookmakerCount: number; avgOverround: number | null; latestFetchAt: string | null }
> {
  const summarize = (snapshotType: SnapshotType) => {
    const subset = rows.filter((row) => row.snapshotType === snapshotType);
    const latest =
      subset.length > 0
        ? subset.reduce(
            (best, row) => (row.observedAt.getTime() > best.getTime() ? row.observedAt : best),
            subset[0]!.observedAt,
          )
        : null;
    return {
      rowCount: subset.length,
      bookmakerCount: new Set(subset.map((row) => row.bookmaker)).size,
      avgOverround:
        subset.length > 0
          ? subset.reduce((sum, row) => sum + row.overround, 0) / subset.length
          : null,
      latestFetchAt: safeDate(latest),
    };
  };

  return {
    opening: summarize("opening"),
    current: summarize("current"),
    closing: summarize("closing"),
  };
}

function latestObservationPerBookmakerAndType(rows: CurrentOddsSnapshot[]): CurrentOddsSnapshot[] {
  const map = new Map<string, CurrentOddsSnapshot>();
  for (const row of rows) {
    const key = `${row.snapshotType}|${row.market}|${row.bookmaker}`;
    const existing = map.get(key);
    if (!existing || row.observedAt.getTime() > existing.observedAt.getTime()) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function actualTargets(fixture: {
  scoreHomeFt: number | null;
  scoreAwayFt: number | null;
}): Record<string, unknown> | null {
  if (fixture.scoreHomeFt == null || fixture.scoreAwayFt == null) return null;
  const home = fixture.scoreHomeFt;
  const away = fixture.scoreAwayFt;
  return {
    homeWin: home > away,
    draw: home === away,
    awayWin: away > home,
    over25: home + away > 2,
    under25: home + away < 3,
    totalGoals: home + away,
    scoreHomeFt: home,
    scoreAwayFt: away,
  };
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, raw) => {
    if (raw instanceof Date) return raw.toISOString();
    return raw;
  });
}

async function recordForwardFeatureSourceSnapshots(params: {
  fixtureId: number;
  capturedAt: Date;
  sourcePayloads: Array<{
    source: FeatureSourceSnapshotSource;
    payload: unknown;
  }>;
}) {
  await prisma.featureSourceSnapshot.createMany({
    data: params.sourcePayloads.map((row) => ({
      fixtureId: params.fixtureId,
      source: row.source,
      capturedAt: params.capturedAt,
      asOfTime: params.capturedAt,
      payloadJson: safeJsonStringify(row.payload),
    })),
  });
}

export async function buildFeatureSnapshotForFixture(
  fixtureId: number,
  optionsOrRunId?: BuildFeatureSnapshotOptions | number,
): Promise<boolean> {
  const options =
    typeof optionsOrRunId === "number" ? { runId: optionsOrRunId } : optionsOrRunId ?? {};
  const runId = options.runId;
  const mode = options.mode ?? "legacy";
  const capturedAt = options.capturedAt ?? new Date();
  const fixture = (await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      competition: { select: { name: true, code: true } },
      homeTeam: { select: { name: true, shortName: true, competitionId: true } },
      awayTeam: { select: { name: true, shortName: true, competitionId: true } },
    },
  })) as FixtureForFeatureBuild | null;

  if (!fixture) return false;

  const kickoff = new Date(fixture.utcDate);
  const existingSnapshot = await prisma.featureSnapshot.findUnique({
    where: {
      fixtureId_featureVersion_snapshotKind: {
        fixtureId,
        featureVersion: FEATURE_STORE_VERSION,
        snapshotKind: "prematch",
      },
    },
    select: {
      snapshotTrust: true,
    },
  });

  if (mode === "forward" && capturedAt.getTime() >= kickoff.getTime()) {
    return false;
  }

  if (mode !== "forward" && existingSnapshot?.snapshotTrust === "forward_safe") {
    return true;
  }

  const snapshotTrust: SnapshotTrust =
    mode === "forward" ? "forward_safe" : DEFAULT_SNAPSHOT_TRUST;
  const leakageChecked = mode === "forward";
  const leakageWarnings =
    mode === "forward"
      ? leakageWarningsJson([])
      : leakageWarningsJson([LEGACY_FEATURE_BUILDER_LEAKAGE_WARNING]);
  const snapshotAsOfTime = mode === "forward" ? capturedAt : kickoff;
  const sourceMaxTimestamp = mode === "forward" ? capturedAt : null;
  const homeStatsCompId = seasonStatsCompetitionId(
    fixture.competitionId,
    fixture.homeTeam.competitionId,
  );
  const awayStatsCompId = seasonStatsCompetitionId(
    fixture.competitionId,
    fixture.awayTeam.competitionId,
  );

  const [
    homeSeasonStats,
    awaySeasonStats,
    homeMatchStats,
    awayMatchStats,
    homeCongestion,
    awayCongestion,
    homeImportance,
    awayImportance,
  ] = await Promise.all([
    prisma.teamSeasonStats.findFirst({
      where: {
        teamId: fixture.homeTeamId,
        competitionId: homeStatsCompId,
        season: CURRENT_SEASON,
      },
    }),
    prisma.teamSeasonStats.findFirst({
      where: {
        teamId: fixture.awayTeamId,
        competitionId: awayStatsCompId,
        season: CURRENT_SEASON,
      },
    }),
    prisma.teamMatchStats.findMany({
      where: {
        teamId: fixture.homeTeamId,
        fixture: { utcDate: { lt: kickoff } },
      },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
      include: { fixture: { select: { utcDate: true, competitionId: true } } },
    }),
    prisma.teamMatchStats.findMany({
      where: {
        teamId: fixture.awayTeamId,
        fixture: { utcDate: { lt: kickoff } },
      },
      orderBy: { fixture: { utcDate: "desc" } },
      take: 15,
      include: { fixture: { select: { utcDate: true, competitionId: true } } },
    }),
    prisma.teamFixtureCongestion.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.homeTeamId, fixtureId } },
    }),
    prisma.teamFixtureCongestion.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.awayTeamId, fixtureId } },
    }),
    prisma.matchImportance.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.homeTeamId, fixtureId } },
    }),
    prisma.matchImportance.findUnique({
      where: { teamId_fixtureId: { teamId: fixture.awayTeamId, fixtureId } },
    }),
  ]);

  const [idA, idB] =
    fixture.homeTeamId < fixture.awayTeamId
      ? [fixture.homeTeamId, fixture.awayTeamId]
      : [fixture.awayTeamId, fixture.homeTeamId];

  const [h2hMatches, homePlayers, awayPlayers, allOddsRaw] = await Promise.all([
    prisma.h2HMatch.findMany({
      where: {
        teamAId: idA,
        teamBId: idB,
        date: { lt: kickoff },
      },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.player.findMany({
      where: { teamId: fixture.homeTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: { where: { status: { in: ["out", "doubt"] } } },
      },
    }),
    prisma.player.findMany({
      where: { teamId: fixture.awayTeamId },
      include: {
        seasonAgg: { where: { season: CURRENT_SEASON } },
        injuries: { where: { status: { in: ["out", "doubt"] } } },
      },
    }),
    prisma.oddsObservation.findMany({
      where: {
        fixtureId,
        observedAt: { lte: kickoff },
        snapshotType: { in: ["opening", "current", "closing"] },
      },
      select: {
        market: true,
        bookmaker: true,
        snapshotType: true,
        outcome1: true,
        outcome2: true,
        outcome3: true,
        impliedProb1: true,
        impliedProb2: true,
        impliedProb3: true,
        overround: true,
        observedAt: true,
      },
    }),
  ]);

  const allOdds = latestObservationPerBookmakerAndType(
    allOddsRaw as CurrentOddsSnapshot[],
  );

  const homeAttack = computeAttackingFeatures(homeMatchStats, homeSeasonStats, true);
  const awayAttack = computeAttackingFeatures(awayMatchStats, awaySeasonStats, false);
  const homeDefense = computeDefensiveFeatures(homeMatchStats, homeSeasonStats, true);
  const awayDefense = computeDefensiveFeatures(awayMatchStats, awaySeasonStats, false);
  const homeForm = computeFormFeatures(homeMatchStats, homeSeasonStats);
  const awayForm = computeFormFeatures(awayMatchStats, awaySeasonStats);
  const homeXgTotal = homeSeasonStats
    ? homeSeasonStats.xgFor / Math.max(homeSeasonStats.matchesPlayed, 1)
    : 1.35;
  const awayXgTotal = awaySeasonStats
    ? awaySeasonStats.xgFor / Math.max(awaySeasonStats.matchesPlayed, 1)
    : 1.35;
  const homeSquad = computeSquadFeatures(homePlayers, homeXgTotal);
  const awaySquad = computeSquadFeatures(awayPlayers, awayXgTotal);
  const h2hFeatures = computeH2HFeatures(h2hMatches, fixture.homeTeamId, fixture.awayTeamId);

  const lastHomeDate = homeMatchStats[0]?.fixture?.utcDate
    ? new Date(homeMatchStats[0].fixture.utcDate)
    : null;
  const isAfterEuropean =
    priorMatchWasEuropean(homeMatchStats, kickoff) || priorMatchWasEuropean(awayMatchStats, kickoff);
  const context = computeContextFeatures(
    homeSeasonStats,
    awaySeasonStats,
    lastHomeDate,
    isAfterEuropean,
    kickoff,
  );

  const currentOdds = allOdds.filter((row) => row.snapshotType === "current");
  const openingOdds = allOdds.filter((row) => row.snapshotType === "opening");
  const closingOdds = allOdds.filter((row) => row.snapshotType === "closing");
  const latestOddsFetch =
    allOdds.length > 0
      ? allOdds.reduce(
          (latest, row) =>
            row.observedAt.getTime() > latest.getTime() ? row.observedAt : latest,
          allOdds[0]!.observedAt,
        )
      : null;

  const marketBaseline = {
    current: {
      homeWin: bestMarketLine(currentOdds, "1x2_home"),
      draw: bestMarketLine(currentOdds, "1x2_draw"),
      awayWin: bestMarketLine(currentOdds, "1x2_away"),
      over25: bestMarketLine(currentOdds, "over25"),
      under25: bestMarketLine(currentOdds, "under25"),
    },
    opening: {
      homeWin: bestMarketLine(openingOdds, "1x2_home"),
      draw: bestMarketLine(openingOdds, "1x2_draw"),
      awayWin: bestMarketLine(openingOdds, "1x2_away"),
      over25: bestMarketLine(openingOdds, "over25"),
      under25: bestMarketLine(openingOdds, "under25"),
    },
    closing: {
      homeWin: bestMarketLine(closingOdds, "1x2_home"),
      draw: bestMarketLine(closingOdds, "1x2_draw"),
      awayWin: bestMarketLine(closingOdds, "1x2_away"),
      over25: bestMarketLine(closingOdds, "over25"),
      under25: bestMarketLine(closingOdds, "under25"),
    },
  };

  const marketFeatures = {
    oddsSnapshotCount: currentOdds.length,
    oddsSnapshotTotalCount: allOdds.length,
    latestOddsFetchAt: safeDate(latestOddsFetch),
    avgOverround:
      currentOdds.length > 0
        ? currentOdds.reduce((sum, row) => sum + row.overround, 0) / currentOdds.length
        : null,
    bookmakerCount: new Set(currentOdds.map((row) => row.bookmaker)).size,
    marketsPresent: Array.from(new Set(currentOdds.map((row) => row.market))).sort(),
    timelineCoverage: summarizeSnapshotCoverage(allOdds),
    baselines: marketBaseline,
  };

  const featurePayload = {
    fixture: {
      fixtureId: fixture.id,
      competitionId: fixture.competitionId,
      competition: fixture.competition.name,
      kickoff: kickoff.toISOString(),
      matchday: fixture.matchday,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      homeTeam: fixture.homeTeam.shortName ?? fixture.homeTeam.name,
      awayTeam: fixture.awayTeam.shortName ?? fixture.awayTeam.name,
      status: fixture.status,
    },
    home: compactTeamFeatures([homeAttack, homeDefense, homeForm, homeSquad]),
    away: compactTeamFeatures([awayAttack, awayDefense, awayForm, awaySquad]),
    context: {
      ...context,
      homeCongestionScore: homeCongestion?.congestionScore ?? null,
      awayCongestionScore: awayCongestion?.congestionScore ?? null,
      homeFatigueModifier: homeCongestion?.fatigueModifier ?? null,
      awayFatigueModifier: awayCongestion?.fatigueModifier ?? null,
      homeMotivationModifier: homeImportance?.lambdaModifier ?? null,
      awayMotivationModifier: awayImportance?.lambdaModifier ?? null,
    },
    h2h: h2hFeatures,
    market: marketFeatures,
  };

  const sourceTimestamps = {
    kickoff: kickoff.toISOString(),
    homeLastMatchAt: safeDate(lastHomeDate),
    awayLastMatchAt: awayMatchStats[0]?.fixture?.utcDate
      ? safeDate(new Date(awayMatchStats[0].fixture.utcDate))
      : null,
    latestOddsFetchAt: safeDate(latestOddsFetch),
    season: CURRENT_SEASON,
    capturedAt: capturedAt.toISOString(),
  };

  if (mode === "forward") {
    await recordForwardFeatureSourceSnapshots({
      fixtureId,
      capturedAt,
      sourcePayloads: [
        {
          source: "fixture_metadata",
          payload: {
            fixture,
            sourceTimestamps,
          },
        },
        {
          source: "team_season_stats",
          payload: {
            homeSeasonStats,
            awaySeasonStats,
            season: CURRENT_SEASON,
          },
        },
        {
          source: "team_recent_match_stats",
          payload: {
            homeMatchStats,
            awayMatchStats,
          },
        },
        {
          source: "team_squad_state",
          payload: {
            homePlayers,
            awayPlayers,
          },
        },
        {
          source: "h2h_history",
          payload: {
            h2hMatches,
          },
        },
        {
          source: "v2_context",
          payload: {
            homeCongestion,
            awayCongestion,
            homeImportance,
            awayImportance,
          },
        },
        {
          source: "odds_observations",
          payload: {
            allOddsRaw,
          },
        },
        {
          source: "derived_feature_payload",
          payload: {
            featurePayload,
            target: actualTargets(fixture),
          },
        },
      ],
    });
  }

  await prisma.featureSnapshot.upsert({
    where: {
      fixtureId_featureVersion_snapshotKind: {
        fixtureId,
        featureVersion: FEATURE_STORE_VERSION,
        snapshotKind: "prematch",
      },
    },
    create: {
      runId,
      fixtureId,
      featureVersion: FEATURE_STORE_VERSION,
      snapshotKind: "prematch",
      asOfTime: snapshotAsOfTime,
      sourceTimestampsJson: JSON.stringify(sourceTimestamps),
      sourceMaxTimestamp,
      featureJson: JSON.stringify(featurePayload),
      targetJson: JSON.stringify(actualTargets(fixture)),
      snapshotTrust,
      leakageChecked,
      leakageWarningsJson: leakageWarnings,
    },
    update: {
      runId,
      asOfTime: snapshotAsOfTime,
      sourceTimestampsJson: JSON.stringify(sourceTimestamps),
      sourceMaxTimestamp,
      featureJson: JSON.stringify(featurePayload),
      targetJson: JSON.stringify(actualTargets(fixture)),
      snapshotTrust,
      leakageChecked,
      leakageWarningsJson: leakageWarnings,
      updatedAt: new Date(),
    },
  });

  return true;
}

export async function buildFeatureStore(params?: {
  daysAhead?: number;
  historicalDays?: number;
  includeFinished?: boolean;
}): Promise<{ runId: number; built: number; fixtureIds: number[] }> {
  const now = new Date();
  const daysAhead = params?.daysAhead ?? 2;
  const historicalDays = params?.historicalDays ?? 30;
  const includeFinished = params?.includeFinished ?? true;
  const start = new Date(now.getTime() - historicalDays * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const run = await prisma.researchRun.create({
    data: {
      runType: "feature_store_build",
      version: FEATURE_STORE_VERSION,
      paramsJson: JSON.stringify({ daysAhead, historicalDays, includeFinished }),
    },
    select: { id: true },
  });

  try {
    const fixtures = await prisma.fixture.findMany({
      where: {
        utcDate: { gte: start, lte: end },
        ...(includeFinished ? {} : { status: { in: ["SCHEDULED", "TIMED"] } }),
      },
      orderBy: { utcDate: "asc" },
      select: { id: true },
    });

    let built = 0;
    const fixtureIds: number[] = [];
    for (const fixture of fixtures) {
      const ok = await buildFeatureSnapshotForFixture(fixture.id, run.id);
      if (!ok) continue;
      built++;
      fixtureIds.push(fixture.id);
    }

    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        rowCount: built,
        completedAt: new Date(),
      },
    });

    return { runId: run.id, built, fixtureIds };
  } catch (error) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function buildForwardFeatureSnapshots(params?: {
  daysAhead?: number;
  competitionIds?: string[];
}): Promise<{ runId: number; built: number; skipped: number; fixtureIds: number[] }> {
  const now = new Date();
  const daysAhead = params?.daysAhead ?? 2;
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const run = await prisma.researchRun.create({
    data: {
      runType: "forward_feature_snapshot_build",
      version: FEATURE_STORE_VERSION,
      paramsJson: JSON.stringify({
        daysAhead,
        competitionIds: params?.competitionIds ?? null,
        capturedAt: now.toISOString(),
      }),
    },
    select: { id: true },
  });

  try {
    const fixtures = await prisma.fixture.findMany({
      where: {
        utcDate: { gt: now, lte: end },
        status: { in: ["SCHEDULED", "TIMED"] },
        ...(params?.competitionIds
          ? { competitionId: { in: params.competitionIds } }
          : {}),
      },
      orderBy: { utcDate: "asc" },
      select: { id: true },
    });

    let built = 0;
    let skipped = 0;
    const fixtureIds: number[] = [];
    for (const fixture of fixtures) {
      const ok = await buildFeatureSnapshotForFixture(fixture.id, {
        runId: run.id,
        mode: "forward",
        capturedAt: now,
      });
      if (!ok) {
        skipped++;
        continue;
      }
      built++;
      fixtureIds.push(fixture.id);
    }

    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        rowCount: built,
        completedAt: new Date(),
      },
    });

    return { runId: run.id, built, skipped, fixtureIds };
  } catch (error) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function getFeatureStoreDataset(limit = 200) {
  const rows = await prisma.featureSnapshot.findMany({
    orderBy: { asOfTime: "desc" },
    take: limit,
    include: {
      fixture: {
        include: {
          competition: { select: { name: true } },
          homeTeam: { select: { name: true, shortName: true } },
          awayTeam: { select: { name: true, shortName: true } },
        },
      },
      run: {
        select: { id: true, startedAt: true, status: true, version: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fixtureId: row.fixtureId,
    featureVersion: row.featureVersion,
    snapshotKind: row.snapshotKind,
    snapshotTrust: row.snapshotTrust,
    leakageChecked: row.leakageChecked,
    leakageWarnings: JSON.parse(row.leakageWarningsJson),
    sourceMaxTimestamp: row.sourceMaxTimestamp,
    asOfTime: row.asOfTime,
    competition: row.fixture.competition.name,
    homeTeam: row.fixture.homeTeam.shortName ?? row.fixture.homeTeam.name,
    awayTeam: row.fixture.awayTeam.shortName ?? row.fixture.awayTeam.name,
    runId: row.run?.id ?? null,
    runStatus: row.run?.status ?? null,
    sourceTimestamps: JSON.parse(row.sourceTimestampsJson),
    features: JSON.parse(row.featureJson),
    targets: row.targetJson ? JSON.parse(row.targetJson) : null,
  }));
}

export async function getFeatureSnapshotTrustSummary() {
  const rows = await prisma.featureSnapshot.groupBy({
    by: ["snapshotTrust"],
    _count: { _all: true },
  });
  const counts = new Map(rows.map((row) => [row.snapshotTrust, row._count._all]));
  return SNAPSHOT_TRUST_LEVELS.map((level) => ({
    snapshotTrust: level,
    count: counts.get(level) ?? 0,
  }));
}

export async function getFeatureSourceSnapshotSummary() {
  const rows = await prisma.featureSourceSnapshot.groupBy({
    by: ["source"],
    _count: { _all: true },
  });
  const counts = new Map(rows.map((row) => [row.source, row._count._all]));
  return FEATURE_SOURCE_SNAPSHOT_SOURCES.map((source) => ({
    source,
    count: counts.get(source) ?? 0,
  }));
}
