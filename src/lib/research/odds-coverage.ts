import { prisma } from "../db";

type SnapshotCoverageRow = {
  id: number;
  featureJson: string;
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function analyzeOddsCoverage(limit = 2000) {
  const rows = (await prisma.featureSnapshot.findMany({
    orderBy: { asOfTime: "desc" },
    take: limit,
    select: { id: true, featureJson: true },
  })) as SnapshotCoverageRow[];

  const summary = {
    snapshots: rows.length,
    withAnyOdds: 0,
    withCurrent1x2: 0,
    withCurrentOu25: 0,
    withOpening1x2: 0,
    withOpeningOu25: 0,
    withClosing1x2: 0,
    withClosingOu25: 0,
  };

  type CompetitionCoverage = {
    snapshots: number;
    anyOdds: number;
    current1x2: number;
    currentOu25: number;
    opening1x2: number;
    openingOu25: number;
    closing1x2: number;
    closingOu25: number;
  };

  const perCompetition = new Map<string, CompetitionCoverage>();

  for (const row of rows) {
    const features = parseJson<Record<string, any>>(row.featureJson, {});
    const competition = String(features.fixture?.competition ?? "unknown");
    const baselines = features.market?.baselines ?? {};
    const oddsSnapshotTotalCount = Number(features.market?.oddsSnapshotTotalCount ?? 0);
    const bucket: CompetitionCoverage =
      perCompetition.get(competition) ?? {
        snapshots: 0,
        anyOdds: 0,
        current1x2: 0,
        currentOu25: 0,
        opening1x2: 0,
        openingOu25: 0,
        closing1x2: 0,
        closingOu25: 0,
      };
    bucket.snapshots++;
    if (oddsSnapshotTotalCount > 0) {
      summary.withAnyOdds++;
      bucket.anyOdds++;
    }

    const hasCurrent1x2 =
      baselines.current?.homeWin != null &&
      baselines.current?.draw != null &&
      baselines.current?.awayWin != null;
    const hasCurrentOu25 =
      baselines.current?.over25 != null && baselines.current?.under25 != null;
    const hasOpening1x2 =
      baselines.opening?.homeWin != null &&
      baselines.opening?.draw != null &&
      baselines.opening?.awayWin != null;
    const hasOpeningOu25 =
      baselines.opening?.over25 != null && baselines.opening?.under25 != null;
    const hasClosing1x2 =
      baselines.closing?.homeWin != null &&
      baselines.closing?.draw != null &&
      baselines.closing?.awayWin != null;
    const hasClosingOu25 =
      baselines.closing?.over25 != null && baselines.closing?.under25 != null;

    if (hasCurrent1x2) {
      summary.withCurrent1x2++;
      bucket.current1x2++;
    }
    if (hasCurrentOu25) {
      summary.withCurrentOu25++;
      bucket.currentOu25++;
    }
    if (hasOpening1x2) {
      summary.withOpening1x2++;
      bucket.opening1x2++;
    }
    if (hasOpeningOu25) {
      summary.withOpeningOu25++;
      bucket.openingOu25++;
    }
    if (hasClosing1x2) {
      summary.withClosing1x2++;
      bucket.closing1x2++;
    }
    if (hasClosingOu25) {
      summary.withClosingOu25++;
      bucket.closingOu25++;
    }

    perCompetition.set(competition, bucket);
  }

  return {
      summary: {
      snapshots: summary.snapshots,
      anyOddsCoverage: summary.snapshots > 0 ? summary.withAnyOdds / summary.snapshots : 0,
      current1x2Coverage: summary.snapshots > 0 ? summary.withCurrent1x2 / summary.snapshots : 0,
      currentOu25Coverage: summary.snapshots > 0 ? summary.withCurrentOu25 / summary.snapshots : 0,
      opening1x2Coverage: summary.snapshots > 0 ? summary.withOpening1x2 / summary.snapshots : 0,
      openingOu25Coverage: summary.snapshots > 0 ? summary.withOpeningOu25 / summary.snapshots : 0,
      closing1x2Coverage: summary.snapshots > 0 ? summary.withClosing1x2 / summary.snapshots : 0,
      closingOu25Coverage: summary.snapshots > 0 ? summary.withClosingOu25 / summary.snapshots : 0,
    },
    byCompetition: Array.from(perCompetition.entries())
      .map(([competition, bucket]) => ({
        competition,
        snapshots: bucket.snapshots,
        anyOddsCoverage: bucket.snapshots > 0 ? bucket.anyOdds / bucket.snapshots : 0,
        current1x2Coverage: bucket.snapshots > 0 ? bucket.current1x2 / bucket.snapshots : 0,
        currentOu25Coverage: bucket.snapshots > 0 ? bucket.currentOu25 / bucket.snapshots : 0,
        opening1x2Coverage: bucket.snapshots > 0 ? bucket.opening1x2 / bucket.snapshots : 0,
        openingOu25Coverage: bucket.snapshots > 0 ? bucket.openingOu25 / bucket.snapshots : 0,
        closing1x2Coverage: bucket.snapshots > 0 ? bucket.closing1x2 / bucket.snapshots : 0,
        closingOu25Coverage: bucket.snapshots > 0 ? bucket.closingOu25 / bucket.snapshots : 0,
      }))
      .sort((a, b) => b.snapshots - a.snapshots),
  };
}
