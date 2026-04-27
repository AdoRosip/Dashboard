import { prisma } from "../db";
import { buildValueMarketCandidates, type SupportedValueMarket } from "./value-candidates";
import {
  evaluateValue,
  VALUE_REJECTION_REASON_LABELS,
  type ValuePolicy,
  type ValueRejectionReason,
} from "./value";
import { MVP_SUPPORTED_COMPETITION_CODES } from "../mvp/config";
import { MVP_PRODUCTION_POLICY, MVP_PRODUCTION_POLICY_VERSION } from "../mvp/policy";
import {
  getProductionValuePrediction,
  MVP_PRODUCTION_MODEL_ROUTING_VERSION,
} from "../mvp/model-routing";

type FixtureWithTeams = {
  id: number;
  utcDate: Date;
  status: string;
  competition: { name: string };
  homeTeam: { name: string; shortName: string | null };
  awayTeam: { name: string; shortName: string | null };
};

export interface MarketValueDiagnostic {
  market: SupportedValueMarket;
  qualifies: boolean;
  reasons: ValueRejectionReason[];
  reasonLabels: string[];
  modelProb: number;
  modelConfidence: number;
  bestOdds: number;
  bestBookmaker: string;
  impliedProb: number;
  rawImpliedProb: number;
  edge: number;
  edgePct: number;
  expectedValue: number;
  kellyFraction: number;
}

export interface FixtureValueDiagnostic {
  fixtureId: number;
  utcDate: Date;
  status: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  predictionAvailable: boolean;
  oddsAvailable: boolean;
  modelConfidence: number | null;
  reasons: string[];
  markets: MarketValueDiagnostic[];
}

export interface ValueDiagnosticsSummary {
  fixturesReviewed: number;
  fixturesWithPrediction: number;
  fixturesWithOdds: number;
  totalCandidates: number;
  qualifyingCandidates: number;
  rejectedCandidates: number;
  rejectionCounts: Array<{
    reason: ValueRejectionReason;
    label: string;
    count: number;
  }>;
}

export interface UpcomingValueDiagnostics {
  generatedAt: string;
  policyVersion: string;
  routingVersion: string;
  policy: ValuePolicy;
  summary: ValueDiagnosticsSummary;
  fixtures: FixtureValueDiagnostic[];
  nearMisses: Array<FixtureValueDiagnostic["markets"][number] & {
    fixtureId: number;
    homeTeam: string;
    awayTeam: string;
    competition: string;
    utcDate: string;
  }>;
}

function displayTeamName(team: { name: string; shortName: string | null }): string {
  return team.shortName ?? team.name;
}

function buildFixtureReasonSet(fixture: FixtureValueDiagnostic): string[] {
  if (!fixture.predictionAvailable) return ["Prediction unavailable"];
  if (!fixture.oddsAvailable) return ["No current odds"];
  if (fixture.markets.length === 0) return ["No supported markets available"];
  if (fixture.markets.some((market) => market.qualifies)) return ["At least one market qualifies"];

  const labels = new Set<string>();
  for (const market of fixture.markets) {
    for (const label of market.reasonLabels) labels.add(label);
  }
  return Array.from(labels);
}

export async function getUpcomingValueDiagnostics(
  days = 2,
  policy: ValuePolicy = MVP_PRODUCTION_POLICY,
): Promise<UpcomingValueDiagnostics> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const fixtures = await prisma.fixture.findMany({
    where: {
      competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
      status: { in: ["SCHEDULED", "TIMED"] },
      utcDate: { gte: now, lte: end },
    },
    include: {
      competition: { select: { name: true } },
      homeTeam: { select: { name: true, shortName: true } },
      awayTeam: { select: { name: true, shortName: true } },
    },
    orderBy: { utcDate: "asc" },
  });

  const fixtureDiagnostics: FixtureValueDiagnostic[] = [];
  const rejectionCounts = new Map<ValueRejectionReason, number>();
  const nearMisses: UpcomingValueDiagnostics["nearMisses"] = [];
  let fixturesWithPrediction = 0;
  let fixturesWithOdds = 0;
  let totalCandidates = 0;
  let qualifyingCandidates = 0;

  for (const fixture of fixtures as FixtureWithTeams[]) {
    let prediction;
    try {
      prediction = await getProductionValuePrediction(fixture.id);
      fixturesWithPrediction++;
    } catch {
      const emptyFixture: FixtureValueDiagnostic = {
        fixtureId: fixture.id,
        utcDate: fixture.utcDate,
        status: fixture.status,
        competition: fixture.competition.name,
        homeTeam: displayTeamName(fixture.homeTeam),
        awayTeam: displayTeamName(fixture.awayTeam),
        predictionAvailable: false,
        oddsAvailable: false,
        modelConfidence: null,
        reasons: ["Prediction unavailable"],
        markets: [],
      };
      fixtureDiagnostics.push(emptyFixture);
      continue;
    }

    const snapshots = await prisma.oddsSnapshot.findMany({
      where: { fixtureId: fixture.id, snapshotType: "current" },
      select: {
        market: true,
        bookmaker: true,
        outcome1: true,
        outcome2: true,
        outcome3: true,
        impliedProb1: true,
        impliedProb2: true,
        impliedProb3: true,
      },
    });

    if (snapshots.length > 0) fixturesWithOdds++;

    const candidates = buildValueMarketCandidates(prediction, snapshots);
    totalCandidates += candidates.length;

    const markets = candidates.map((candidate) => {
      const evaluation = evaluateValue(candidate, policy);
      if (evaluation.qualifies) {
        qualifyingCandidates++;
      } else {
        for (const reason of evaluation.reasons) {
          rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
        }
      }

      const marketDiagnostic: MarketValueDiagnostic = {
        market: candidate.market,
        qualifies: evaluation.qualifies,
        reasons: evaluation.reasons,
        reasonLabels: evaluation.reasons.map((reason) => VALUE_REJECTION_REASON_LABELS[reason]),
        modelProb: candidate.modelProb,
        modelConfidence: candidate.modelConfidence,
        bestOdds: candidate.bestOdds,
        bestBookmaker: candidate.bestBookmaker,
        impliedProb: evaluation.metrics.impliedProb,
        rawImpliedProb: evaluation.metrics.rawImpliedProb,
        edge: evaluation.metrics.edge,
        edgePct: evaluation.metrics.edgePct,
        expectedValue: evaluation.metrics.expectedValue,
        kellyFraction: evaluation.metrics.kellyFraction,
      };

      if (!marketDiagnostic.qualifies) {
        nearMisses.push({
          fixtureId: fixture.id,
          homeTeam: displayTeamName(fixture.homeTeam),
          awayTeam: displayTeamName(fixture.awayTeam),
          competition: fixture.competition.name,
          utcDate: fixture.utcDate.toISOString(),
          ...marketDiagnostic,
        });
      }

      return marketDiagnostic;
    });

    const fixtureDiagnostic: FixtureValueDiagnostic = {
      fixtureId: fixture.id,
      utcDate: fixture.utcDate,
      status: fixture.status,
      competition: fixture.competition.name,
      homeTeam: displayTeamName(fixture.homeTeam),
      awayTeam: displayTeamName(fixture.awayTeam),
      predictionAvailable: true,
      oddsAvailable: snapshots.length > 0,
      modelConfidence: prediction.modelConfidence,
      reasons: [],
      markets,
    };
    fixtureDiagnostic.reasons = buildFixtureReasonSet(fixtureDiagnostic);
    fixtureDiagnostics.push(fixtureDiagnostic);
  }

  nearMisses.sort((a, b) => {
    if (b.edge !== a.edge) return b.edge - a.edge;
    return b.expectedValue - a.expectedValue;
  });

  return {
    generatedAt: new Date().toISOString(),
    policyVersion: MVP_PRODUCTION_POLICY_VERSION,
    routingVersion: MVP_PRODUCTION_MODEL_ROUTING_VERSION,
    policy,
    summary: {
      fixturesReviewed: fixtures.length,
      fixturesWithPrediction,
      fixturesWithOdds,
      totalCandidates,
      qualifyingCandidates,
      rejectedCandidates: totalCandidates - qualifyingCandidates,
      rejectionCounts: Array.from(rejectionCounts.entries())
        .map(([reason, count]) => ({
          reason,
          label: VALUE_REJECTION_REASON_LABELS[reason],
          count,
        }))
        .sort((a, b) => b.count - a.count),
    },
    fixtures: fixtureDiagnostics,
    nearMisses: nearMisses.slice(0, 15),
  };
}
