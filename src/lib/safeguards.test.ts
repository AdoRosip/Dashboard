/**
 * Targeted correctness tests (node:test + tsx). Run: `npm test`
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calibrationSeasonKeyFromFixture } from "@/lib/calibration";
import { remapH2hTripleToFixtureOrientation } from "@/lib/odds/event-side";
import { isOddsEventSwappedVsFixture } from "@/lib/odds/team-normalize";
import { isVoidFixtureStatus } from "@/lib/odds/settle";
import { checkValue, evaluateValue } from "@/lib/odds/value";
import { chooseProduction1x2Candidate } from "@/lib/odds/value-picks-service";
import { getScopedCaptureMatchRate } from "@/lib/mvp/health";
import { normalizeProduction1x2Probs } from "@/lib/mvp/model-routing";
import { assessResearchEvidenceReadiness } from "@/lib/research/readiness";
import {
  DEFAULT_SNAPSHOT_TRUST,
  FEATURE_SOURCE_SNAPSHOT_SOURCES,
  SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS,
  isSnapshotTrust,
  leakageWarningsJson,
} from "@/lib/research/snapshot-trust";
import { researchSnapshotWhere } from "@/lib/research/datasets";
import {
  combineWeightedRate,
  computeWeightedLambdaV3,
  computeH2HFeatures,
  goalsScoredByTeamInH2hRow,
  type H2hMatchScoreRow,
} from "@/lib/prediction/features";

describe("remapH2hTripleToFixtureOrientation", () => {
  test("swaps home/away prices when event is flipped vs fixture", () => {
    const eventOrdered: [number, number, number] = [2.0, 3.4, 4.0];
    const remapped = remapH2hTripleToFixtureOrientation(eventOrdered, true);
    assert.deepEqual(remapped, [4.0, 3.4, 2.0]);
  });

  test("passes through when orientations match", () => {
    const t: [number, number, number] = [1.9, 3.5, 4.2];
    assert.deepEqual(remapH2hTripleToFixtureOrientation(t, false), t);
  });
});

describe("isOddsEventSwappedVsFixture", () => {
  test("detects swapped bookmaker home/away labels", () => {
    assert.equal(
      isOddsEventSwappedVsFixture(
        "Arsenal",
        "Chelsea",
        "Chelsea",
        "Arsenal",
      ),
      true,
    );
    assert.equal(
      isOddsEventSwappedVsFixture(
        "Arsenal",
        "Chelsea",
        "Arsenal",
        "Chelsea",
      ),
      false,
    );
  });
});

describe("goalsScoredByTeamInH2hRow", () => {
  test("uses historical venue when homeTeamId is set", () => {
    const m: H2hMatchScoreRow = {
      teamAId: 10,
      teamBId: 20,
      scoreA: 1,
      scoreB: 2,
      homeTeamId: 20,
    };
    assert.equal(goalsScoredByTeamInH2hRow(m, 10), 1);
    assert.equal(goalsScoredByTeamInH2hRow(m, 20), 2);
  });

  test("falls back to canonical teamA/teamB when homeTeamId missing", () => {
    const m: H2hMatchScoreRow = { teamAId: 5, teamBId: 8, scoreA: 3, scoreB: 0 };
    assert.equal(goalsScoredByTeamInH2hRow(m, 5), 3);
    assert.equal(goalsScoredByTeamInH2hRow(m, 8), 0);
  });
});

describe("computeH2HFeatures", () => {
  test("attributes wins to upcoming home/away teams using per-match scores", () => {
    const rows: H2hMatchScoreRow[] = [
      { teamAId: 1, teamBId: 2, scoreA: 2, scoreB: 1, homeTeamId: 2 },
    ];
    const h = computeH2HFeatures(rows, 1, 2);
    assert.equal(h.totalMeetings, 1);
    assert.equal(h.homeWinRate, 1);
    assert.equal(h.awayWinRate, 0);
  });
});

describe("checkValue Kelly fields", () => {
  test("stores full-precision Kelly fractions (not display-rounded)", () => {
    const d = checkValue({
      market: "1x2_home",
      modelProb: 0.5,
      modelConfidence: 0.8,
      bestOdds: 2.2,
      impliedProb: 0.42,
    });
    assert.ok(d != null);
    const expectedKelly = (0.5 * 2.2 - 1) / (2.2 - 1);
    const clamped = Math.max(0, Math.min(0.1, expectedKelly));
    assert.ok(Math.abs(d!.kellyFraction - clamped) < 1e-12);
    assert.ok(Math.abs(d!.quarterKelly - clamped * 0.25) < 1e-12);
    assert.ok(Math.abs(d!.halfKelly - clamped * 0.5) < 1e-12);
  });
});

describe("evaluateValue policy gates", () => {
  test("rejects markets with positive edge but negative EV", () => {
    const result = evaluateValue({
      market: "over25",
      modelProb: 0.74,
      modelConfidence: 0.65,
      bestOdds: 1.25,
      impliedProb: 0.7,
    });
    assert.equal(result.qualifies, false);
    assert.ok(result.reasons.includes("expected_value_below_min"));
    assert.equal(result.draft, null);
  });

  test("keeps qualifying markets when edge and EV are both positive", () => {
    const result = evaluateValue({
      market: "1x2_home",
      modelProb: 0.48,
      modelConfidence: 0.62,
      bestOdds: 2.35,
      impliedProb: 0.4,
    });
    assert.equal(result.qualifies, true);
    assert.deepEqual(result.reasons, []);
    assert.ok(result.draft != null);
  });
});

describe("chooseProduction1x2Candidate", () => {
  test("selects only the strongest qualifying 1X2 candidate for a fixture", () => {
    const home = {
      market: "1x2_home" as const,
      modelProb: 0.52,
      modelConfidence: 0.75,
      bestOdds: 2.3,
      bestBookmaker: "a",
      impliedProb: 0.42,
      rawImpliedProb: 1 / 2.3,
    };
    const draw = {
      market: "1x2_draw" as const,
      modelProb: 0.31,
      modelConfidence: 0.75,
      bestOdds: 4.2,
      bestBookmaker: "b",
      impliedProb: 0.23,
      rawImpliedProb: 1 / 4.2,
    };
    const selected = chooseProduction1x2Candidate([
      { candidate: home, evaluation: evaluateValue(home) },
      { candidate: draw, evaluation: evaluateValue(draw) },
    ]);

    assert.equal(selected?.candidate.market, "1x2_draw");
  });
});

describe("settlement void statuses", () => {
  test("CANCELLED and POSTPONED void picks", () => {
    assert.equal(isVoidFixtureStatus("CANCELLED"), true);
    assert.equal(isVoidFixtureStatus("POSTPONED"), true);
    assert.equal(isVoidFixtureStatus("FINISHED"), false);
  });
});

describe("calibrationSeasonKeyFromFixture", () => {
  test("uses UTC calendar year from kickoff", () => {
    const y = calibrationSeasonKeyFromFixture(new Date("2026-01-15T12:00:00.000Z"));
    assert.equal(y, "2026");
  });
});

describe("normalizeProduction1x2Probs", () => {
  test("normalizes mixed-route 1X2 probabilities to one distribution", () => {
    const p = normalizeProduction1x2Probs({
      home: 0.77,
      draw: 0.33,
      away: 0.07,
    });
    assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
    assert.ok(p.home > p.draw);
    assert.ok(p.draw > p.away);
  });

  test("rejects impossible all-zero 1X2 probabilities", () => {
    assert.throws(
      () => normalizeProduction1x2Probs({ home: 0, draw: 0, away: 0 }),
      /sum is not positive/,
    );
  });
});

describe("getScopedCaptureMatchRate", () => {
  test("ignores non-MVP sport results when computing the gate metric", () => {
    const rate = getScopedCaptureMatchRate(
      JSON.stringify([
        {
          sportKey: "soccer_uefa_champs_league",
          fixturesTargeted: 1,
          fixturesMatched: 0,
        },
        {
          sportKey: "soccer_uefa_europa_conference_league",
          fixturesTargeted: 9,
          fixturesMatched: 0,
        },
      ]),
      [
        "soccer_epl",
        "soccer_spain_la_liga",
        "soccer_germany_bundesliga",
        "soccer_italy_serie_a",
        "soccer_france_ligue_one",
      ],
    );
    assert.equal(rate, null);
  });

  test("computes the match rate from MVP-scope sport results only", () => {
    const rate = getScopedCaptureMatchRate(
      JSON.stringify([
        {
          sportKey: "soccer_epl",
          fixturesTargeted: 3,
          fixturesMatched: 2,
        },
        {
          sportKey: "soccer_spain_la_liga",
          fixturesTargeted: 1,
          fixturesMatched: 1,
        },
        {
          sportKey: "soccer_uefa_champs_league",
          fixturesTargeted: 4,
          fixturesMatched: 0,
        },
      ]),
      [
        "soccer_epl",
        "soccer_spain_la_liga",
      ],
    );
    assert.equal(rate, 0.75);
  });
});

describe("assessResearchEvidenceReadiness", () => {
  test("blocks production evidence when odds coverage or leakage remediation is insufficient", () => {
    const evidence = assessResearchEvidenceReadiness({
      historicalAnyOddsCoverage: 0.07,
      historicalCurrent1x2Coverage: 0.07,
      historicalClosingCoverage: 0,
      featureStoreLeakageRemediated: false,
    });

    assert.equal(evidence.productionEvidenceReady, false);
    assert.equal(evidence.leakageRisk, true);
    assert.ok(evidence.blockers.some((reason) => reason.includes("leakage")));
  });

  test("allows production evidence only when coverage and leakage contracts pass", () => {
    const evidence = assessResearchEvidenceReadiness({
      historicalAnyOddsCoverage: 0.8,
      historicalCurrent1x2Coverage: 0.75,
      historicalClosingCoverage: 0.5,
      safeFeatureSnapshots: 300,
      safeSettledFixtures: 150,
      sourceCategoriesComplete: true,
      featureStoreLeakageRemediated: true,
    });

    assert.equal(evidence.productionEvidenceReady, true);
    assert.deepEqual(evidence.blockers, []);
  });
});

describe("snapshot trust contract", () => {
  test("defaults legacy feature snapshots to unsafe reconstructed", () => {
    assert.equal(DEFAULT_SNAPSHOT_TRUST, "unsafe_reconstructed");
  });

  test("accepts only known snapshot trust levels", () => {
    assert.equal(isSnapshotTrust("forward_safe"), true);
    assert.equal(isSnapshotTrust("reconstructed_safe"), true);
    assert.equal(isSnapshotTrust("unsafe_reconstructed"), true);
    assert.equal(isSnapshotTrust("trusted_because_i_said_so"), false);
  });

  test("deduplicates leakage warning payloads", () => {
    assert.equal(leakageWarningsJson(["a", "a", "b"]), JSON.stringify(["a", "b"]));
  });

  test("research datasets exclude unsafe snapshots by default", () => {
    assert.deepEqual(SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS, [
      "forward_safe",
      "reconstructed_safe",
    ]);
    assert.deepEqual(researchSnapshotWhere(), {
      targetJson: { not: null },
      snapshotTrust: { in: ["forward_safe", "reconstructed_safe"] },
    });
  });

  test("research datasets require explicit opt-in for unsafe diagnostics", () => {
    assert.deepEqual(
      researchSnapshotWhere({
        onlySettled: false,
        trustLevels: ["unsafe_reconstructed"],
      }),
      {
        snapshotTrust: { in: ["unsafe_reconstructed"] },
      },
    );
  });

  test("declares source snapshot categories needed for forward auditability", () => {
    assert.deepEqual(FEATURE_SOURCE_SNAPSHOT_SOURCES, [
      "fixture_metadata",
      "team_season_stats",
      "team_recent_match_stats",
      "team_squad_state",
      "h2h_history",
      "v2_context",
      "odds_observations",
      "derived_feature_payload",
    ]);
  });
});

describe("engine-v3 weighted rates", () => {
  test("renormalizes source weights when recent data is missing", () => {
    const rate = combineWeightedRate({
      recentOverall: null,
      recentVenue: null,
      season: 1.8,
      leaguePrior: 1.35,
      weights: {
        recentOverall: 0.45,
        recentVenue: 0.2,
        season: 0.25,
        leaguePrior: 0.1,
      },
    });
    assert.ok(Math.abs(rate.weights.season + rate.weights.leaguePrior - 1) < 1e-12);
    assert.equal(rate.weights.recentOverall, 0);
    assert.equal(rate.weights.recentVenue, 0);
    assert.ok(rate.value > 1.35);
    assert.ok(rate.value < 1.8);
  });

  test("applies home advantage after team-specific modifiers", () => {
    const home = computeWeightedLambdaV3({
      attackRating: 1.35,
      opponentDefenseRating: 1.35,
      isHome: true,
      homeAdvantageGoals: 0.2,
      leagueAvgXg: 1.35,
      modifiers: { form: 0.8 },
      minLambda: 0.3,
      maxLambda: 4.2,
    });
    assert.ok(Math.abs(home.baseLambda - 1.35) < 1e-12);
    assert.ok(Math.abs(home.lambda - (1.35 * 0.8 + 0.1)) < 1e-12);
  });
});
