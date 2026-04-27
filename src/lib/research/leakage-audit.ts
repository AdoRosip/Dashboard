import { prisma } from "../db";
import {
  FEATURE_SOURCE_SNAPSHOT_SOURCES,
  SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS,
} from "./snapshot-trust";

export interface LeakageAuditReport {
  generatedAt: string;
  status: "pass" | "fail";
  summary: {
    totalFeatureSnapshots: number;
    safeFeatureSnapshots: number;
    unsafeFeatureSnapshots: number;
    forwardSafeSnapshots: number;
    reconstructedSafeSnapshots: number;
    featureSourceSnapshots: number;
    sourceTimestampViolations: number;
    forwardSafeAfterKickoff: number;
    forwardSafeMissingSourceFixtures: number;
    safeSettledFixtures: number;
  };
  blockers: string[];
  sourceCoverage: Array<{
    source: string;
    count: number;
  }>;
  forwardSafeMissingSources: Array<{
    fixtureId: number;
    missingSources: string[];
  }>;
  sourceTimestampViolations: Array<{
    snapshotId: number;
    fixtureId: number;
    asOfTime: string;
    sourceMaxTimestamp: string;
  }>;
  forwardSafeAfterKickoff: Array<{
    snapshotId: number;
    fixtureId: number;
    asOfTime: string;
    kickoff: string;
  }>;
}

export async function buildLeakageAuditReport(): Promise<LeakageAuditReport> {
  const [
    totalFeatureSnapshots,
    safeFeatureSnapshots,
    forwardSafeSnapshots,
    reconstructedSafeSnapshots,
    featureSourceSnapshots,
    sourceRows,
    safeSnapshots,
    timestampViolationRows,
    safeSettledRows,
  ] = await Promise.all([
    prisma.featureSnapshot.count(),
    prisma.featureSnapshot.count({
      where: { snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] } },
    }),
    prisma.featureSnapshot.count({ where: { snapshotTrust: "forward_safe" } }),
    prisma.featureSnapshot.count({ where: { snapshotTrust: "reconstructed_safe" } }),
    prisma.featureSourceSnapshot.count(),
    prisma.featureSourceSnapshot.groupBy({
      by: ["source"],
      _count: { _all: true },
    }),
    prisma.featureSnapshot.findMany({
      where: { snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] } },
      select: {
        id: true,
        fixtureId: true,
        snapshotTrust: true,
        asOfTime: true,
        sourceMaxTimestamp: true,
        fixture: { select: { utcDate: true } },
      },
    }),
    prisma.featureSnapshot.findMany({
      where: {
        snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] },
        sourceMaxTimestamp: { not: null },
      },
      select: {
        id: true,
        fixtureId: true,
        asOfTime: true,
        sourceMaxTimestamp: true,
      },
    }),
    prisma.featureSnapshot.findMany({
      where: {
        snapshotTrust: { in: [...SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS] },
        targetJson: { not: null },
        fixture: {
          scoreHomeFt: { not: null },
          scoreAwayFt: { not: null },
        },
      },
      select: { fixtureId: true },
      distinct: ["fixtureId"],
    }),
  ]);

  const sourceCounts = new Map(sourceRows.map((row) => [row.source, row._count._all]));
  const sourceCoverage = FEATURE_SOURCE_SNAPSHOT_SOURCES.map((source) => ({
    source,
    count: sourceCounts.get(source) ?? 0,
  }));

  const sourceRowsByFixture =
    safeSnapshots.length > 0
      ? await prisma.featureSourceSnapshot.findMany({
          where: {
            fixtureId: { in: safeSnapshots.map((row) => row.fixtureId) },
          },
          select: { fixtureId: true, source: true },
        })
      : [];
  const sourcesByFixture = new Map<number, Set<string>>();
  for (const row of sourceRowsByFixture) {
    const sources = sourcesByFixture.get(row.fixtureId) ?? new Set<string>();
    sources.add(row.source);
    sourcesByFixture.set(row.fixtureId, sources);
  }

  const forwardSafeMissingSources = safeSnapshots
    .filter((row) => row.snapshotTrust === "forward_safe")
    .map((row) => {
      const sources = sourcesByFixture.get(row.fixtureId) ?? new Set<string>();
      const missingSources = FEATURE_SOURCE_SNAPSHOT_SOURCES.filter(
        (source) => !sources.has(source),
      );
      return {
        fixtureId: row.fixtureId,
        missingSources,
      };
    })
    .filter((row) => row.missingSources.length > 0);

  const sourceTimestampViolations = timestampViolationRows
    .filter(
      (row) =>
        row.sourceMaxTimestamp != null &&
        row.sourceMaxTimestamp.getTime() > row.asOfTime.getTime(),
    )
    .map((row) => ({
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      asOfTime: row.asOfTime.toISOString(),
      sourceMaxTimestamp: row.sourceMaxTimestamp!.toISOString(),
    }));

  const forwardSafeAfterKickoff = safeSnapshots
    .filter(
      (row) =>
        row.snapshotTrust === "forward_safe" &&
        row.asOfTime.getTime() >= row.fixture.utcDate.getTime(),
    )
    .map((row) => ({
      snapshotId: row.id,
      fixtureId: row.fixtureId,
      asOfTime: row.asOfTime.toISOString(),
      kickoff: row.fixture.utcDate.toISOString(),
    }));

  const unsafeFeatureSnapshots = Math.max(0, totalFeatureSnapshots - safeFeatureSnapshots);
  const blockers: string[] = [];
  if (sourceTimestampViolations.length > 0) {
    blockers.push(
      `${sourceTimestampViolations.length} safe snapshot(s) have source timestamps after asOfTime.`,
    );
  }
  if (forwardSafeAfterKickoff.length > 0) {
    blockers.push(`${forwardSafeAfterKickoff.length} forward-safe snapshot(s) were captured after kickoff.`);
  }
  if (forwardSafeMissingSources.length > 0) {
    blockers.push(
      `${forwardSafeMissingSources.length} forward-safe fixture(s) are missing required source snapshots.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    status: blockers.length === 0 ? "pass" : "fail",
    summary: {
      totalFeatureSnapshots,
      safeFeatureSnapshots,
      unsafeFeatureSnapshots,
      forwardSafeSnapshots,
      reconstructedSafeSnapshots,
      featureSourceSnapshots,
      sourceTimestampViolations: sourceTimestampViolations.length,
      forwardSafeAfterKickoff: forwardSafeAfterKickoff.length,
      forwardSafeMissingSourceFixtures: forwardSafeMissingSources.length,
      safeSettledFixtures: safeSettledRows.length,
    },
    blockers,
    sourceCoverage,
    forwardSafeMissingSources,
    sourceTimestampViolations,
    forwardSafeAfterKickoff,
  };
}
