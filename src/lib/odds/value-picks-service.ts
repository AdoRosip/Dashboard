import { prisma } from "../db";
import {
  MVP_PRODUCTION_POLICY,
  MVP_PRODUCTION_POLICY_VERSION,
  serializeMvpProductionPolicy,
} from "../mvp/policy";
import {
  getProductionValuePrediction,
  MVP_PRODUCTION_MODEL_ROUTING_VERSION,
} from "../mvp/model-routing";
import {
  backfillBetDecisionsFromValuePicks,
  createBetDecisionFromAcceptedCandidate,
} from "./bet-decisions";
import { buildValueMarketCandidates, SUPPORTED_VALUE_MARKETS } from "./value-candidates";
import { evaluateValue, type ValueCheckResult } from "./value";
import { MVP_SUPPORTED_COMPETITION_CODES } from "../mvp/config";

type EvaluatedCandidate = {
  candidate: ReturnType<typeof buildValueMarketCandidates>[number];
  evaluation: ValueCheckResult;
};

function compareEvaluatedCandidates(a: EvaluatedCandidate, b: EvaluatedCandidate): number {
  const evDiff = b.evaluation.metrics.expectedValue - a.evaluation.metrics.expectedValue;
  if (evDiff !== 0) return evDiff;

  const edgeDiff = b.evaluation.metrics.edge - a.evaluation.metrics.edge;
  if (edgeDiff !== 0) return edgeDiff;

  const confidenceDiff =
    b.evaluation.metrics.modelConfidence - a.evaluation.metrics.modelConfidence;
  if (confidenceDiff !== 0) return confidenceDiff;

  return b.evaluation.metrics.bestOdds - a.evaluation.metrics.bestOdds;
}

export function chooseProduction1x2Candidate(
  evaluated: EvaluatedCandidate[],
): EvaluatedCandidate | null {
  const qualifying = evaluated.filter((item) => item.evaluation.draft != null);
  if (qualifying.length === 0) return null;
  return qualifying.slice().sort(compareEvaluatedCandidates)[0] ?? null;
}

/**
 * Recompute value picks for upcoming fixtures using latest model + current odds snapshots.
 */
export async function recomputeValuePicksForUpcoming(days = 2): Promise<number> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const policyJson = serializeMvpProductionPolicy();

  await backfillBetDecisionsFromValuePicks();

  const fixtures = await prisma.fixture.findMany({
    where: {
      // Do not flag value on postponed/cancelled fixtures (settlement voids existing rows).
      competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
      status: { in: ["SCHEDULED", "TIMED"] },
      utcDate: { gte: now, lte: end },
    },
  });

  const run = await prisma.valuePickRun.create({
    data: {
      modelVersion: `${MVP_PRODUCTION_MODEL_ROUTING_VERSION}:${MVP_PRODUCTION_POLICY_VERSION}`,
      policyJson,
      daysAhead: days,
      fixturesConsidered: fixtures.length,
    },
    select: { id: true },
  });

  let created = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;

  try {
    for (const fx of fixtures) {
      const validMarkets = new Set<string>();

      let pred;
      try {
        pred = await getProductionValuePrediction(fx.id);
      } catch {
        continue;
      }
      const productionModelVersion = `${pred.modelVersion}:${MVP_PRODUCTION_POLICY_VERSION}`;

      const snaps = await prisma.oddsSnapshot.findMany({
        where: { fixtureId: fx.id, snapshotType: "current" },
      });

      const evaluatedCandidates = buildValueMarketCandidates(pred, snaps).map((candidate) => ({
        candidate,
        evaluation: evaluateValue(candidate, MVP_PRODUCTION_POLICY),
      }));
      const selectedCandidate = chooseProduction1x2Candidate(evaluatedCandidates);

      for (const { candidate, evaluation } of evaluatedCandidates) {
        const draft = evaluation.draft;
        const accepted = selectedCandidate?.candidate.market === candidate.market && draft != null;
        const rejectionReasons = accepted
          ? evaluation.reasons
          : draft
            ? [...evaluation.reasons, "portfolio_not_best_1x2" as const]
            : evaluation.reasons;
        if (accepted) acceptedCount++;
        else rejectedCount++;

        const loggedCandidate = await prisma.valuePickCandidate.create({
          data: {
            runId: run.id,
            fixtureId: fx.id,
            market: candidate.market,
            bestBookmaker: candidate.bestBookmaker,
            accepted,
            rejectionReasons: JSON.stringify(rejectionReasons),
            modelVersion: productionModelVersion,
            policyJson,
            modelProb: evaluation.metrics.modelProb,
            modelConfidence: evaluation.metrics.modelConfidence,
            bestOdds: evaluation.metrics.bestOdds,
            rawImpliedProb: evaluation.metrics.rawImpliedProb,
            impliedProb: evaluation.metrics.impliedProb,
            edge: evaluation.metrics.edge,
            edgePct: evaluation.metrics.edgePct,
            expectedValue: evaluation.metrics.expectedValue,
            kellyFraction: evaluation.metrics.kellyFraction,
            stakeUnits: draft?.stakeUnits ?? null,
            rating: draft?.rating ?? null,
            ratingLabel: draft?.ratingLabel ?? null,
          },
          select: { id: true },
        });

        if (!accepted || !draft) continue;

        draft.bestBookmaker = candidate.bestBookmaker;
        validMarkets.add(candidate.market);

        await createBetDecisionFromAcceptedCandidate({
          candidateId: loggedCandidate.id,
          fixtureId: fx.id,
          market: candidate.market,
          modelVersion: productionModelVersion,
          policyJson,
          bestBookmaker: candidate.bestBookmaker,
          modelProb: evaluation.metrics.modelProb,
          modelConfidence: evaluation.metrics.modelConfidence,
          bestOdds: evaluation.metrics.bestOdds,
          rawImpliedProb: evaluation.metrics.rawImpliedProb,
          impliedProb: evaluation.metrics.impliedProb,
          edge: evaluation.metrics.edge,
          edgePct: evaluation.metrics.edgePct,
          expectedValue: evaluation.metrics.expectedValue,
          kellyFraction: evaluation.metrics.kellyFraction,
          stakeUnits: draft.stakeUnits,
          rating: draft.rating,
          ratingLabel: draft.ratingLabel,
        });

        const existingPick = await prisma.valuePick.findFirst({
          where: { fixtureId: fx.id, market: candidate.market },
          select: { id: true, settled: true },
        });
        if (existingPick?.settled) continue;

        const payload = {
          modelProb: draft.modelProb,
          modelConfidence: draft.modelConfidence,
          bestOdds: draft.bestOdds,
          bestBookmaker: draft.bestBookmaker,
          impliedProb: draft.impliedProb,
          edge: draft.edge,
          edgePct: draft.edgePct,
          kellyFraction: draft.kellyFraction,
          quarterKelly: draft.quarterKelly,
          halfKelly: draft.halfKelly,
          stakeUnits: draft.stakeUnits,
          rating: draft.rating,
          ratingLabel: draft.ratingLabel,
        };
        if (existingPick) {
          await prisma.valuePick.update({
            where: { id: existingPick.id },
            data: payload,
          });
        } else {
          await prisma.valuePick.create({
            data: { fixtureId: fx.id, market: candidate.market, ...payload },
          });
        }
        created++;
      }

      await prisma.valuePick.deleteMany({
        where: {
          fixtureId: fx.id,
          settled: false,
          market: { in: [...SUPPORTED_VALUE_MARKETS] },
          NOT: { market: { in: Array.from(validMarkets) } },
        },
      });
    }

    await prisma.valuePickRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        acceptedCount,
        rejectedCount,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.valuePickRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        acceptedCount,
        rejectedCount,
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }

  return created;
}
