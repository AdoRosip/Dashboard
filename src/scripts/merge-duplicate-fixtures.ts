import { prisma } from "../lib/db";

type FixtureRefCounts = {
  teamMatchStats: number;
  playerMatchStats: number;
  predictions: number;
  playerAvailabilities: number;
  teamFixtureCongestions: number;
  matchImportances: number;
  matchContextFlags: number;
  oddsSnapshots: number;
  oddsObservations: number;
  valuePicks: number;
  valuePickCandidates: number;
  betDecisions: number;
  featureSnapshots: number;
};

type DuplicateFixture = {
  id: number;
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  utcDate: Date;
  status: string;
  scoreHomeFt: number | null;
  scoreAwayFt: number | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
  _count: FixtureRefCounts;
};

type DuplicateGroup = {
  key: string;
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  day: string;
  fixtures: DuplicateFixture[];
};

type MergeStats = {
  groupsReviewed: number;
  groupsMerged: number;
  duplicateFixturesMerged: number;
  rowsMoved: Record<string, number>;
  rowsDeleted: Record<string, number>;
  canonicalStatsUpdated: number;
};

const APPLY = process.argv.includes("--apply") || process.env.APPLY === "true";
const LIMIT = readLimitArg();
const SYNTHETIC_FIXTURE_ID_START = 700000;

const emptyStats = (): MergeStats => ({
  groupsReviewed: 0,
  groupsMerged: 0,
  duplicateFixturesMerged: 0,
  rowsMoved: {},
  rowsDeleted: {},
  canonicalStatsUpdated: 0,
});

function readLimitArg(): number | null {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) return null;
  const parsed = Number(limitArg.slice("--limit=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function increment(target: Record<string, number>, key: string, by = 1): void {
  target[key] = (target[key] ?? 0) + by;
}

function fixtureReferenceCount(fixture: DuplicateFixture): number {
  return Object.values(fixture._count).reduce((total, count) => total + count, 0);
}

function canonicalScore(fixture: DuplicateFixture): number {
  const sourceScore = fixture.id >= SYNTHETIC_FIXTURE_ID_START ? 0 : 100000;
  const relationScore = fixtureReferenceCount(fixture) * 10;
  const resultScore = fixture.scoreHomeFt != null && fixture.scoreAwayFt != null ? 1000 : 0;
  return sourceScore + relationScore + resultScore - fixture.id / 1000000;
}

function pickCanonicalFixture(fixtures: DuplicateFixture[]): DuplicateFixture {
  return [...fixtures].sort((a, b) => canonicalScore(b) - canonicalScore(a))[0]!;
}

async function findDuplicateFinishedFixtureGroups(): Promise<DuplicateGroup[]> {
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: "FINISHED",
      scoreHomeFt: { not: null },
      scoreAwayFt: { not: null },
    },
    select: {
      id: true,
      competitionId: true,
      homeTeamId: true,
      awayTeamId: true,
      utcDate: true,
      status: true,
      scoreHomeFt: true,
      scoreAwayFt: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      _count: {
        select: {
          teamMatchStats: true,
          playerMatchStats: true,
          predictions: true,
          playerAvailabilities: true,
          teamFixtureCongestions: true,
          matchImportances: true,
          matchContextFlags: true,
          oddsSnapshots: true,
          oddsObservations: true,
          valuePicks: true,
          valuePickCandidates: true,
          betDecisions: true,
          featureSnapshots: true,
        },
      },
    },
    orderBy: [{ utcDate: "desc" }, { id: "asc" }],
  });

  const groups = new Map<string, DuplicateGroup>();
  for (const fixture of fixtures) {
    const day = dayKey(fixture.utcDate);
    const key = [
      fixture.competitionId,
      fixture.homeTeamId,
      fixture.awayTeamId,
      day,
    ].join("|");
    const group = groups.get(key) ?? {
      key,
      competitionId: fixture.competitionId,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      day,
      fixtures: [],
    };
    group.fixtures.push(fixture);
    groups.set(key, group);
  }

  return Array.from(groups.values()).filter((group) => group.fixtures.length > 1);
}

function richerTeamMatchStatsData(
  canonical: {
    xg: number;
    xgAgainst: number;
    shots: number;
    shotsOnTarget: number;
    possessionPct: number;
  },
  duplicate: {
    goalsScored: number;
    goalsConceded: number;
    goalsFirstHalf: number;
    goalsSecondHalf: number;
    shots: number;
    shotsOnTarget: number;
    possessionPct: number;
    corners: number;
    fouls: number;
    offsides: number;
    yellowCards: number;
    redCards: number;
    xg: number;
    xgAgainst: number;
    xgOpenPlay: number;
    xgSetPiece: number;
    xgCounter: number;
    xgFirstHalf: number;
    xgSecondHalf: number;
    ppda: number | null;
    progressivePasses: number;
    progressiveCarries: number;
    deepCompletions: number;
    tacklesWon: number;
    interceptions: number;
    blocks: number;
    clearances: number;
    cornersWon: number;
    goalsFromSetPieces: number;
    xgFromSetPieces: number;
    xgOverperformance: number;
  },
) {
  const canonicalSignal =
    canonical.xg +
    canonical.xgAgainst +
    canonical.shots +
    canonical.shotsOnTarget +
    canonical.possessionPct;
  const duplicateSignal =
    duplicate.xg +
    duplicate.xgAgainst +
    duplicate.shots +
    duplicate.shotsOnTarget +
    duplicate.possessionPct;

  if (duplicateSignal <= canonicalSignal) return null;

  return {
    goalsScored: duplicate.goalsScored,
    goalsConceded: duplicate.goalsConceded,
    goalsFirstHalf: duplicate.goalsFirstHalf,
    goalsSecondHalf: duplicate.goalsSecondHalf,
    shots: duplicate.shots,
    shotsOnTarget: duplicate.shotsOnTarget,
    possessionPct: duplicate.possessionPct,
    corners: duplicate.corners,
    fouls: duplicate.fouls,
    offsides: duplicate.offsides,
    yellowCards: duplicate.yellowCards,
    redCards: duplicate.redCards,
    xg: duplicate.xg,
    xgAgainst: duplicate.xgAgainst,
    xgOpenPlay: duplicate.xgOpenPlay,
    xgSetPiece: duplicate.xgSetPiece,
    xgCounter: duplicate.xgCounter,
    xgFirstHalf: duplicate.xgFirstHalf,
    xgSecondHalf: duplicate.xgSecondHalf,
    ppda: duplicate.ppda,
    progressivePasses: duplicate.progressivePasses,
    progressiveCarries: duplicate.progressiveCarries,
    deepCompletions: duplicate.deepCompletions,
    tacklesWon: duplicate.tacklesWon,
    interceptions: duplicate.interceptions,
    blocks: duplicate.blocks,
    clearances: duplicate.clearances,
    cornersWon: duplicate.cornersWon,
    goalsFromSetPieces: duplicate.goalsFromSetPieces,
    xgFromSetPieces: duplicate.xgFromSetPieces,
    xgOverperformance: duplicate.xgOverperformance,
  };
}

async function mergeUniqueTeamRows(
  duplicateFixtureId: number,
  canonicalFixtureId: number,
  stats: MergeStats,
): Promise<void> {
  const duplicateRows = await prisma.teamMatchStats.findMany({
    where: { fixtureId: duplicateFixtureId },
  });

  for (const row of duplicateRows) {
    const canonicalRow = await prisma.teamMatchStats.findUnique({
      where: {
        fixtureId_teamId: {
          fixtureId: canonicalFixtureId,
          teamId: row.teamId,
        },
      },
    });

    if (!canonicalRow) {
      await prisma.teamMatchStats.update({
        where: { id: row.id },
        data: { fixtureId: canonicalFixtureId },
      });
      increment(stats.rowsMoved, "TeamMatchStats");
      continue;
    }

    const richerData = richerTeamMatchStatsData(canonicalRow, row);
    if (richerData) {
      await prisma.teamMatchStats.update({
        where: { id: canonicalRow.id },
        data: richerData,
      });
      stats.canonicalStatsUpdated++;
    }

    await prisma.teamMatchStats.delete({ where: { id: row.id } });
    increment(stats.rowsDeleted, "TeamMatchStats");
  }
}

async function moveOrDeleteByUniqueKey(
  modelName: string,
  duplicateFixtureId: number,
  canonicalFixtureId: number,
  stats: MergeStats,
  rows: Array<{ id: number; key: Record<string, unknown> }>,
  exists: (key: Record<string, unknown>) => Promise<boolean>,
  move: (id: number) => Promise<void>,
  remove: (id: number) => Promise<void>,
): Promise<void> {
  for (const row of rows) {
    if (await exists(row.key)) {
      await remove(row.id);
      increment(stats.rowsDeleted, modelName);
    } else {
      await move(row.id);
      increment(stats.rowsMoved, modelName);
    }
  }
}

async function mergeUniqueFixtureRelations(
  duplicateFixtureId: number,
  canonicalFixtureId: number,
  stats: MergeStats,
): Promise<void> {
  await mergeUniqueTeamRows(duplicateFixtureId, canonicalFixtureId, stats);

  const playerMatchStats = await prisma.playerMatchStats.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, playerId: true },
  });
  await moveOrDeleteByUniqueKey(
    "PlayerMatchStats",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    playerMatchStats.map((row) => ({ id: row.id, key: { playerId: row.playerId } })),
    async (key) =>
      Boolean(
        await prisma.playerMatchStats.findUnique({
          where: {
            fixtureId_playerId: {
              fixtureId: canonicalFixtureId,
              playerId: Number(key.playerId),
            },
          },
        }),
      ),
    (id) => prisma.playerMatchStats.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.playerMatchStats.delete({ where: { id } }).then(),
  );

  const predictions = await prisma.prediction.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, modelVersion: true },
  });
  await moveOrDeleteByUniqueKey(
    "Prediction",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    predictions.map((row) => ({ id: row.id, key: { modelVersion: row.modelVersion } })),
    async (key) =>
      Boolean(
        await prisma.prediction.findUnique({
          where: {
            fixtureId_modelVersion: {
              fixtureId: canonicalFixtureId,
              modelVersion: String(key.modelVersion),
            },
          },
        }),
      ),
    (id) => prisma.prediction.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.prediction.delete({ where: { id } }).then(),
  );

  const playerAvailabilities = await prisma.playerAvailability.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, playerId: true },
  });
  await moveOrDeleteByUniqueKey(
    "PlayerAvailability",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    playerAvailabilities.map((row) => ({ id: row.id, key: { playerId: row.playerId } })),
    async (key) =>
      Boolean(
        await prisma.playerAvailability.findUnique({
          where: {
            playerId_fixtureId: {
              fixtureId: canonicalFixtureId,
              playerId: Number(key.playerId),
            },
          },
        }),
      ),
    (id) => prisma.playerAvailability.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.playerAvailability.delete({ where: { id } }).then(),
  );

  const teamFixtureCongestions = await prisma.teamFixtureCongestion.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, teamId: true },
  });
  await moveOrDeleteByUniqueKey(
    "TeamFixtureCongestion",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    teamFixtureCongestions.map((row) => ({ id: row.id, key: { teamId: row.teamId } })),
    async (key) =>
      Boolean(
        await prisma.teamFixtureCongestion.findUnique({
          where: {
            teamId_fixtureId: {
              fixtureId: canonicalFixtureId,
              teamId: Number(key.teamId),
            },
          },
        }),
      ),
    (id) => prisma.teamFixtureCongestion.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.teamFixtureCongestion.delete({ where: { id } }).then(),
  );

  const matchImportances = await prisma.matchImportance.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, teamId: true },
  });
  await moveOrDeleteByUniqueKey(
    "MatchImportance",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    matchImportances.map((row) => ({ id: row.id, key: { teamId: row.teamId } })),
    async (key) =>
      Boolean(
        await prisma.matchImportance.findUnique({
          where: {
            teamId_fixtureId: {
              fixtureId: canonicalFixtureId,
              teamId: Number(key.teamId),
            },
          },
        }),
      ),
    (id) => prisma.matchImportance.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.matchImportance.delete({ where: { id } }).then(),
  );

  const oddsObservations = await prisma.oddsObservation.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: {
      id: true,
      bookmaker: true,
      market: true,
      snapshotType: true,
      observedAt: true,
    },
  });
  await moveOrDeleteByUniqueKey(
    "OddsObservation",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    oddsObservations.map((row) => ({
      id: row.id,
      key: {
        bookmaker: row.bookmaker,
        market: row.market,
        snapshotType: row.snapshotType,
        observedAt: row.observedAt,
      },
    })),
    async (key) =>
      Boolean(
        await prisma.oddsObservation.findUnique({
          where: {
            fixtureId_bookmaker_market_snapshotType_observedAt: {
              fixtureId: canonicalFixtureId,
              bookmaker: String(key.bookmaker),
              market: String(key.market),
              snapshotType: String(key.snapshotType),
              observedAt: key.observedAt as Date,
            },
          },
        }),
      ),
    (id) => prisma.oddsObservation.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.oddsObservation.delete({ where: { id } }).then(),
  );

  const valuePicks = await prisma.valuePick.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, market: true },
  });
  await moveOrDeleteByUniqueKey(
    "ValuePick",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    valuePicks.map((row) => ({ id: row.id, key: { market: row.market } })),
    async (key) =>
      Boolean(
        await prisma.valuePick.findUnique({
          where: {
            fixtureId_market: {
              fixtureId: canonicalFixtureId,
              market: String(key.market),
            },
          },
        }),
      ),
    (id) => prisma.valuePick.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.valuePick.delete({ where: { id } }).then(),
  );

  const betDecisions = await prisma.betDecision.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, market: true },
  });
  await moveOrDeleteByUniqueKey(
    "BetDecision",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    betDecisions.map((row) => ({ id: row.id, key: { market: row.market } })),
    async (key) =>
      Boolean(
        await prisma.betDecision.findUnique({
          where: {
            fixtureId_market: {
              fixtureId: canonicalFixtureId,
              market: String(key.market),
            },
          },
        }),
      ),
    (id) => prisma.betDecision.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.betDecision.delete({ where: { id } }).then(),
  );

  const predictionAudits = await prisma.predictionAudit.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, market: true },
  });
  await moveOrDeleteByUniqueKey(
    "PredictionAudit",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    predictionAudits.map((row) => ({ id: row.id, key: { market: row.market } })),
    async (key) =>
      Boolean(
        await prisma.predictionAudit.findUnique({
          where: {
            fixtureId_market: {
              fixtureId: canonicalFixtureId,
              market: String(key.market),
            },
          },
        }),
      ),
    (id) => prisma.predictionAudit.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.predictionAudit.delete({ where: { id } }).then(),
  );

  const featureSnapshots = await prisma.featureSnapshot.findMany({
    where: { fixtureId: duplicateFixtureId },
    select: { id: true, featureVersion: true, snapshotKind: true },
  });
  await moveOrDeleteByUniqueKey(
    "FeatureSnapshot",
    duplicateFixtureId,
    canonicalFixtureId,
    stats,
    featureSnapshots.map((row) => ({
      id: row.id,
      key: { featureVersion: row.featureVersion, snapshotKind: row.snapshotKind },
    })),
    async (key) =>
      Boolean(
        await prisma.featureSnapshot.findUnique({
          where: {
            fixtureId_featureVersion_snapshotKind: {
              fixtureId: canonicalFixtureId,
              featureVersion: String(key.featureVersion),
              snapshotKind: String(key.snapshotKind),
            },
          },
        }),
      ),
    (id) => prisma.featureSnapshot.update({ where: { id }, data: { fixtureId: canonicalFixtureId } }).then(),
    (id) => prisma.featureSnapshot.delete({ where: { id } }).then(),
  );
}

async function moveNonUniqueFixtureRelations(
  duplicateFixtureId: number,
  canonicalFixtureId: number,
  stats: MergeStats,
): Promise<void> {
  const operations = [
    {
      name: "H2HMatch",
      move: () =>
        prisma.h2HMatch.updateMany({
          where: { fixtureId: duplicateFixtureId },
          data: { fixtureId: canonicalFixtureId },
        }),
    },
    {
      name: "MatchContextFlag",
      move: () =>
        prisma.matchContextFlag.updateMany({
          where: { fixtureId: duplicateFixtureId },
          data: { fixtureId: canonicalFixtureId },
        }),
    },
    {
      name: "OddsSnapshot",
      move: () =>
        prisma.oddsSnapshot.updateMany({
          where: { fixtureId: duplicateFixtureId },
          data: { fixtureId: canonicalFixtureId },
        }),
    },
    {
      name: "ValuePickCandidate",
      move: () =>
        prisma.valuePickCandidate.updateMany({
          where: { fixtureId: duplicateFixtureId },
          data: { fixtureId: canonicalFixtureId },
        }),
    },
  ];

  for (const operation of operations) {
    const result = await operation.move();
    increment(stats.rowsMoved, operation.name, result.count);
  }
}

async function mergeDuplicateFixture(
  duplicateFixtureId: number,
  canonicalFixtureId: number,
  stats: MergeStats,
): Promise<void> {
  await mergeUniqueFixtureRelations(duplicateFixtureId, canonicalFixtureId, stats);
  await moveNonUniqueFixtureRelations(duplicateFixtureId, canonicalFixtureId, stats);
  await prisma.fixture.delete({ where: { id: duplicateFixtureId } });
  increment(stats.rowsDeleted, "Fixture");
  stats.duplicateFixturesMerged++;
}

async function main(): Promise<void> {
  const stats = emptyStats();
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 60000");
  const allGroups = await findDuplicateFinishedFixtureGroups();
  const groups = LIMIT == null ? allGroups : allGroups.slice(0, LIMIT);

  console.log("Duplicate fixture merge");
  console.log("=======================");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Duplicate groups found: ${allGroups.length}`);
  if (LIMIT != null) console.log(`Limit: ${LIMIT}`);
  console.log("");

  for (const group of groups) {
    stats.groupsReviewed++;
    const canonical = pickCanonicalFixture(group.fixtures);
    const duplicates = group.fixtures.filter((fixture) => fixture.id !== canonical.id);
    const label = `${canonical.homeTeam.name} vs ${canonical.awayTeam.name}`;
    const ids = group.fixtures.map((fixture) => fixture.id).join(", ");
    const duplicateIds = duplicates.map((fixture) => fixture.id).join(", ");

    console.log(
      `- ${group.day} ${group.competitionId}: ${label} [${ids}] -> canonical ${canonical.id}; duplicate ${duplicateIds}`,
    );

    if (!APPLY) continue;

    for (const duplicate of duplicates) {
      await mergeDuplicateFixture(duplicate.id, canonical.id, stats);
    }
    stats.groupsMerged++;
  }

  console.log("");
  console.log("Summary");
  console.log(`Groups reviewed: ${stats.groupsReviewed}`);
  console.log(`Groups merged: ${stats.groupsMerged}`);
  console.log(`Duplicate fixtures merged: ${stats.duplicateFixturesMerged}`);
  console.log(`Canonical TeamMatchStats rows enriched: ${stats.canonicalStatsUpdated}`);
  console.log(`Rows moved: ${JSON.stringify(stats.rowsMoved)}`);
  console.log(`Rows deleted: ${JSON.stringify(stats.rowsDeleted)}`);

  if (!APPLY) {
    console.log("");
    console.log("Dry-run only. Re-run with --apply after reviewing the proposed canonical choices.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
