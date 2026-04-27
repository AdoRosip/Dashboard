# Code Review Remediation Plan

Created: 2026-04-26

## Summary

The project is working mechanically, but several data and modeling contracts are not strong enough for production betting decisions. The immediate problems are:

- Duplicate real matches caused by synthetic Understat fixtures.
- Incoherent production 1X2 probabilities caused by mixing independent model routes without normalization.
- Research/backtest leakage risk from feature snapshots rebuilt with current data.
- Product performance mixing production, legacy, and experimental decisions.
- Odds matching that can still silently fall back to unsafe outcome ordering.

Until these are fixed, value-pick output should be treated as diagnostic only.

## Phase 1: Stop The Bleeding

Goal: prevent obviously invalid picks from being published.

Tasks:

1. Block production output when 1X2 probabilities do not form a valid distribution.
2. Add tests for production probability coherence.
3. Add a duplicate-fixture audit.
4. Quarantine existing picks produced from invalid or legacy logic.

Exit condition:

- No production pick can be generated from invalid 1X2 probabilities or known duplicate fixture state.

## Phase 2: Canonical Fixture Identity

Goal: one real-world match should have one canonical fixture row.

Tasks:

1. Make Understat attach xG/team/player stats to existing Football-Data fixtures by competition, teams, and match date.
2. Create synthetic Understat fixtures only when no canonical fixture exists.
3. Build a cleanup script to merge existing synthetic duplicate fixtures into canonical fixtures.
4. Rebuild H2H and recent-form inputs after cleanup.

Exit condition:

- Recent form and H2H show each real match once.
- Prediction features use one fixture per real match.

## Phase 3: Production Probability Contract

Goal: every 1X2 pick must compare bookmaker probability against a coherent model distribution.

Tasks:

1. Normalize final production `1x2_home`, `1x2_draw`, and `1x2_away` probabilities after model routing.
2. Store raw model-source probabilities separately when needed for diagnostics.
3. Add tests proving production 1X2 probabilities sum to one.
4. Add health-gate checks for impossible probability distributions.

Exit condition:

- Final production 1X2 probabilities always sum to `1.0` within tolerance.

## Phase 4: Research And Backtest Rebuild

Goal: make research evidence usable for production decisions.

Tasks:

1. Rebuild historical feature snapshots from data that was available before kickoff.
2. Remove look-ahead leakage from current-season aggregates.
3. Re-run baseline, readiness, odds coverage, and walk-forward research.
4. Promote only markets that beat bookmaker baselines out of sample.

Exit condition:

- Backtest results are based on true pre-match data and can guide production routing.

## Phase 5: Value Policy And Results Cleanup

Goal: make recommendation and performance reporting auditable.

Tasks:

1. Keep MVP production scope limited to top five domestic leagues and `1x2` markets.
2. Exclude legacy and experimental markets from product-facing performance.
3. Store production scope, model route, policy version, and data-quality version on accepted decisions.
4. Add rejection reasons for duplicate fixture risk, stale odds, unsupported market, and invalid probability sum.

Exit condition:

- Every visible pick has one clear fixture, model, policy, market, bookmaker line, and rationale.

## Phase 6: UI And Ops Trust Pass

Goal: make the interface reflect trust state accurately.

Tasks:

1. Recent form and H2H should read from canonical fixture data only.
2. Results should separate production, legacy, and experimental records.
3. Ops should expose duplicate counts, odds match rate, model probability checks, and latest publish status.
4. Product copy should avoid overstating model certainty.

Exit condition:

- The UI no longer presents research or invalid outputs as trusted production recommendations.

## Implementation Order

1. Document plan.
2. Fix Understat fixture attachment.
3. Normalize production 1X2 probabilities.
4. Add correctness tests.
5. Add existing-data cleanup and audit script.
6. Rebuild research data and rerun evaluation.
7. Clean up product performance and UI trust surfaces.
