# Football Analytics Dashboard — Technical Reference

This document describes **how this application works end-to-end**: data ingestion, the prediction model (math and code paths), odds handling, value betting, settlement, and calibration/metrics. It reflects the **current implementation** in this repository.

---

## 1. Stack and layout


| Layer                  | Technology                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| App                    | Next.js (App Router), React, TypeScript                                                     |
| Database               | Prisma ORM (default dev DB: SQLite `file:./dev.db` — see `prisma/schema.prisma` and `.env`) |
| External football data | Football-Data.org API (`src/lib/api-client.ts`, `src/lib/ingest.ts`)                        |
| xG enrichment          | Understat scraping (`src/lib/scrapers/understat-ingest.ts`)                                 |
| Bookmaker odds         | The Odds API (`src/lib/odds/fetch.ts`)                                                      |


Important library paths:

- **Predictions:** `src/lib/prediction/engine.ts`, `poisson.ts`, `features.ts`, `league-params.ts`
- **Odds & betting:** `src/lib/odds/` (`fetch.ts`, `margin.ts`, `value.ts`, `value-picks-service.ts`, `settle.ts`, `performance.ts`)
- **Calibration:** `src/lib/calibration.ts`, `src/lib/calibration/metrics.ts`
- **V2 context (fatigue, motivation, rotation):** `src/lib/prediction/pipeline-v2.ts`, `congestion.ts`, `motivation.ts`, `rotation.ts`

---

## 2. Data pipeline (day-to-day)

### 2.1 Match and stats ingestion

- `**npm run ingest`** (or `**POST /api/refresh`**) runs `refreshAll()` in `src/lib/ingest.ts`.
- It syncs competitions, teams, fixtures, results, standings, scorers, and related stats from **Football-Data.org** into Prisma models (`Fixture`, `Team`, `TeamSeasonStats`, `TeamMatchStats`, etc.).
- Season and competition codes are driven by `src/lib/constants.ts` (e.g. `CURRENT_SEASON`, `COMPETITIONS`).

### 2.2 Understat (xG)

- `**npm run ingest:understat`** runs Understat-based ingestion for supported leagues (`UNDERSTAT_LEAGUE_MAP` in `constants.ts`).

### 2.3 V2 “context” layers (upcoming fixtures)

- `**refreshV2ForUpcomingFixtures`** (`pipeline-v2.ts`) runs as part of ingest (see `ingest.ts`). It fills **congestion**, **match importance**, **rotation / availability** style inputs for fixtures in the next window (default ~7 days), used later by `predictMatch`.

### 2.4 Odds

- `**POST /api/odds/refresh`** (or ingest hook) calls `**refreshOddsForUpcomingFixtures(days)`** (`fetch.ts`): pulls **h2h** and **totals 2.5** from The Odds API for fixtures in the DB that are upcoming in that window.
- For each bookmaker/market it stores `**OddsSnapshot`** rows:
  - `**opening`**: first time seen for that fixture/bookmaker/market.
  - `**current`**: updated on each refresh; duplicates for `current` are removed in application logic.
- **Implied probabilities** stored on snapshots are **de-vigged** with a **multiplicative** normalization (`removeMargin` in `margin.ts`): if raw implied probabilities are q_i = 1/O_i, then fair p_i = q_i / \sum_j q_j. `**overround`** on the row is the raw \sum_i 1/O_i before de-vig.

### 2.5 Value picks

- After odds refresh, `**recomputeValuePicksForUpcoming(days)`** (`value-picks-service.ts`) runs: for each upcoming fixture it loads the **model** (`predictMatch`) and **current** odds, evaluates candidate markets, and upserts `**ValuePick`** rows when filters pass (see §6).

---

## 3. Prediction model

### 3.1 Entry point and versioning

- `**predictMatch(fixtureId)`** (`engine.ts`) is the main entry.
- `**MODEL_VERSION`** (e.g. `v2.0-dc-poisson`) is stored on each `**Prediction`** row. One row per `(fixtureId, modelVersion)` (unique constraint).
- **Caching:** If a prediction exists for that fixture/version and is **newer than `PREDICTION_CACHE_HOURS` (6)** measured from `**updatedAt`** (fallback `createdAt`), the cached DB row is returned without recomputing.

### 3.2 Expected goals (λ) per team

**Goal:** scalar **λ_home**, **λ_away** = expected goals for each side in the match.

**Base construction (`computeLambda` in `features.ts`):**

- League baseline `**LEAGUE_AVG_XG = 1.35`** (goals/xG scale for attack/defense strength).
- Attack strength \approx team attack rating / `LEAGUE_AVG_XG`.
- Defense weakness \approx opponent defensive rating / `LEAGUE_AVG_XG`.
- Core product:  
\lambda \leftarrow \texttt{LEAGUEAVGXG} \times \text{attackStrength} \times \text{defenseWeakness}.
- **Home advantage** is applied in **goals** space symmetrically: home gets `+homeAdvantageGoals/2`, away `-homeAdvantageGoals/2` (see `HOME_ADVANTAGE_GOALS_BY_LEAGUE` in `engine.ts`).
- Then **multiplicative modifiers** (each typically near 1): injury/squad, form, H2H, fatigue, motivation, context, regression-to-mean. See `engine.ts` for how each is computed from DB features.
- Final λ is **clamped** to `**[0.3, 5.0]`**.

Ratings feeding `computeLambda` come from **season stats**, **recent match stats**, **tactical classification**, **H2H**, **squad/rotation**, etc., as wired in `engine.ts`.

### 3.3 Dixon–Coles adjusted Poisson (`poisson.ts`)

**Independent Poisson** would use  
P(H=i, A=j) \propto \text{Poisson}(i \mid \lambda_H)\text{Poisson}(j \mid \lambda_A).

**Dixon–Coles** multiplies four low-score cells by factors depending on **ρ** (correlation parameter):

- (0,0), (1,0), (0,1), (1,1) get adjustments; other cells use factor 1.
- Negative ρ (typical) increases mass on 0–0 and 1–1 relative to independent Poisson.

**ρ construction (`engine.ts` + `league-params.ts`):**

- **Base** ρ by competition: `DIXON_COLES_RHO_BASE` (fallback `DEFAULT_DIXON_COLES_RHO = -0.05`).
- **Tactical adjustment:** e.g. deep-block vs deep-block → base − 0.03; press vs press → base + 0.03.
- **Derby:** extra shift when rivalry flag is set.

The joint table is built on a **finite grid**: each team’s goals run from **0 to `MAX_GOALS - 1`** with `**MAX_GOALS = 12**` (i.e. 0–11 goals per side). Anything beyond the grid is **truncated**; cell probabilities are **renormalized** to sum to 1. That implies **tail mass is folded** into the grid (see audit notes in code comments).

Negative adjusted masses are **floored at 0** before normalization.

### 3.4 Derived markets from the score matrix

All of the following use the **same normalized matrix** (so they are **internally consistent** under that truncation):


| Output                   | Definition                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| **1X2**                  | Sum i>j → home, i=j → draw, i<j → away                                     |
| **Over/Under 0.5 … 4.5** | Sum over cells with i+j > t for “over” at threshold t                      |
| **BTTS**                 | Yes = sum over i \ge 1, j \ge 1; No = 1 − Yes (within the truncated model) |
| **Clean sheets**         | Home CS = P(A=0); Away CS = P(H=0)                                         |


### 3.5 HT/FT (`htFtProbs`)

- **Not** the same joint model as full-time only: it splits λ into **first half** and **second half** using `**htGoalShare(competitionId)`** (defaults in `league-params.ts`, clamped to ~[0.38, 0.48]).
- Builds two truncated matrices (half-time and “second period” λ) with **ρ × 0.5** on DC, assumes **independence** between halves, and sums over score pairs that match HT and FT result classes.
- Treat as a **heuristic** market, not guaranteed consistent with the single-matrix FT 1X2.

### 3.6 `modelConfidence` (for value picks, not statistical uncertainty)

- Blend of **data completeness** (how much history/squad data was available) and **1X2 sharpness** via **normalized Shannon entropy** of (P(H), P(D), P(A)): more uniform 1X2 → lower “confidence” in this scalar; peakier → higher.
- This is **not** a calibrated posterior variance; it gates **value-pick ratings** together with edge thresholds in `value.ts`.

---

## 4. Odds, implied probability, and value

### 4.1 De-vigging (`margin.ts`)

For outcomes with decimal odds (O_1,\ldots,O_n):

- Raw implied: q_i = 1/O_i.
- Fair: p_i = q_i / \sum_j q_j.

These p_i are what get stored as `**impliedProb1`**, etc., on `**OddsSnapshot`**.

### 4.2 Value check (`value.ts`)

For a candidate bet:

- **Edge (probability):** `edge = modelProb - impliedProb` (model vs de-vigged fair implied for that outcome).
- **Kelly (full, fraction of bankroll)** for a binary win/lose at decimal odds O:

f^* = \frac{p \cdot O - 1}{O - 1}

implemented as `**(modelProb * bestOdds - 1) / (bestOdds - 1)`**, then **clamped** to **[0, 0.1]**.

- **Displayed fractional stakes:** `quarterKelly`, `halfKelly` are fractions of that clamped Kelly.
- **Filters (typical):** minimum edge (e.g. 3%), minimum `modelConfidence`, minimum `modelProb`, minimum odds — see `checkValue` in `value.ts`.

### 4.3 Which picks get stored (`value-picks-service.ts`)

For each **SCHEDULED** or **TIMED** fixture in the next **N** days (postponed/cancelled are excluded so picks are not re-flagged while unresolved):

- Candidates: **1x2_home**, **1x2_draw**, **1x2_away**, **over25**, **under25** (model prob for under = 1 - P(\text{over 2.5})).
- For each, finds **best decimal odds** across bookmakers for that outcome (not the same as best “value” across all outcomes — it’s per-outcome line shopping).
- Runs `**checkValue`**. If it passes, creates or updates a `**ValuePick`** for that `(fixtureId, market)` while **unsettled**.

**Note:** BTTS value picks are **not** created in this loop in the current code (settlement still supports `btts_yes` / `btts_no` if rows exist).

---

## 5. Settlement and betting performance

### 5.1 Settling picks (`settle.ts`)

`**settleValuePicks()`**:

- Loads all `**ValuePick`** with `**settled: false`**.
- **`CANCELLED`** / **`POSTPONED`** fixtures → **`outcome: void`**, `profitLoss: 0`, settled.
- Otherwise waits until **`scoreHomeFt`** / **`scoreAwayFt`** exist (does not require `status === FINISHED` if scores are present after ingest lag).
- Resolves **win/loss** from `**market`** and score:
  - 1X2 vs result; **Over 2.5** if total goals **> 2**; **Under 2.5** if **< 3** (exactly 2 goals counts as under); **BTTS** if both teams scored.
- **Stake:** `**stakeUnits`** when set, else derived from rating + EV (`**stake-units.ts`**) — same units as P/L.
- **P/L:** win → `stake * (bestOdds - 1)`; loss → `-stake`.
- **Closing line:** prefers `**OddsSnapshot`** with `snapshotType: "closing"`; if missing, uses latest `**current`** and sets `**closingLineSnapshotKind: "current_fallback"` on the pick (not true CLV). Headline **average CLV** in `**performance.ts`** only averages rows where `closingLineSnapshotKind === "closing"`.

### 5.2 Aggregates (`performance.ts`)

`**recomputeBettingPerformance()**` aggregates **settled** picks into `**BettingPerformance`** (e.g. all-time row with ROI, hit rate, average CLV). Used after settlement (e.g. `**npm run betting:settle`**).

---

## 6. Calibration and “model performance”

### 6.1 `runCalibrationForFinishedFixtures` (`calibration.ts`)

- Iterates recent **finished** fixtures with scores (up to **2000** per run, newest first).
- Loads `**Prediction`** for `**MODEL_VERSION`** if present, else latest `**updatedAt`** row for that fixture.
- For each fixture writes `**PredictionAudit`** rows (upsert per `fixtureId` + `market`) and updates `**CalibrationBucket`** when the audit row is **new** — audit + bucket run in one **transaction** so reruns do not double-count buckets and partial writes cannot leave audit without bucket.
- Bucket **`season`** uses the fixture kickoff **UTC calendar year** (`**calibrationSeasonKeyFromFixture**`), not a global “current season” constant.

**Headline metrics (mean Brier):**

- Markets `**1x2_home`**, `**1x2_draw`**, `**1x2_away**` (binary Brier each), plus `**over25**`, `**btts_yes**` — see `HEADLINE_CALIBRATION_MARKETS` in `calibration/metrics.ts` and `meanHeadlineBrier`. Multinomial Brier helpers remain in `metrics.ts` for optional offline use.

**Buckets:** probability bins (0–10%, …) per market/league/season; running **actual hit rate** vs bin midpoint → **calibration error**.

### 6.2 UI

- `**/model-performance`**: summary Brier (headline vs all rows), betting aggregates, **settled value picks** table, calibration buckets.
- Triggers: `**POST /api/calibration/run`**, `**npm run calibration:run`**.

---

## 7. Database models (conceptual)


| Model                                  | Role                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `Fixture`, `Team`, `Competition`       | Core schedule and metadata                                   |
| `TeamSeasonStats`, `TeamMatchStats`, … | Features for λ                                               |
| `Prediction`                           | Cached model output per `fixtureId` + `modelVersion`         |
| `OddsSnapshot`                         | Bookmaker lines (`opening` / `current` / optional `closing`) |
| `ValuePick`                            | Candidate bet line + odds + Kelly + settlement               |
| `BettingPerformance`                   | Rolled-up P&L stats                                          |
| `PredictionAudit`                      | Per-fixture per-market scoring vs outcome                    |
| `CalibrationBucket`                    | Histogram calibration by prob bin                            |


See `**prisma/schema.prisma**` for exact fields and indexes.

---

## 8. Commands and HTTP endpoints (reference)


| Action                                | Command / route                                          |
| ------------------------------------- | -------------------------------------------------------- |
| Dev server                            | `npm run dev`                                            |
| Ingest football data                  | `npm run ingest` or `POST /api/refresh`                  |
| Refresh odds + rebuild value picks    | `POST /api/odds/refresh`                                 |
| Settle bets + recompute betting stats | `npm run betting:settle` or `POST /api/betting/settle`   |
| Run calibration                       | `npm run calibration:run` or `POST /api/calibration/run` |
| Unit tests (safeguards)               | `npm test`                                               |
| Prisma client                         | `npm run db:generate`                                    |
| Push schema                           | `npm run db:push`                                        |


**Environment variables (typical):**

- `**DATABASE_URL`** — Prisma connection string (see `.env.example`).
- `**FOOTBALL_DATA_API_KEY`** — Football-Data.org (`ingest`, `daily`).
- `**ODDS_API_KEY`** — The Odds API (`refreshOddsForUpcomingFixtures`, value picks); optional — odds steps no-op when unset.
- `**API_FOOTBALL_KEY`** — optional ping / future wiring (`api-client.ts`).
- `**AHEAD_DAYS**` — upcoming fixture window for ingest (default from constants).
- `**RESULTS_DAYS**` — how far back to pull results (default 7).
- `**SKIP_UNDERSTAT**` — set `true` to skip Understat in `daily` / ingest.
- `**CURRENT_SEASON**` — used by Understat scraper when set (see `understat-ingest.ts`).

---

## 9. Limitations (explicit)

1. **Truncated Poisson grid** distorts very high-λ tail markets unless the grid is large enough.
2. **ρ and HT share** are **heuristic / league tables**, not full MLE on your database (extensible later).
3. **Value picks** only auto-generate for **1X2 + O/U 2.5** in `value-picks-service.ts` as written.
4. **Calibration** uses **stored predictions** at run time; it does not automatically snapshot “price at kickoff” unless your workflow only updates predictions before kickoff.
5. `**modelConfidence`** is **not** a statistical confidence interval for λ or probabilities.

---

## 10. File map (quick)

```
src/lib/prediction/engine.ts    # predictMatch, save, cache, λ → matrix → outputs
src/lib/prediction/poisson.ts  # Dixon–Coles, derived markets, HT/FT
src/lib/prediction/features.ts # computeLambda, feature computations
src/lib/prediction/league-params.ts
src/lib/odds/value.ts          # Kelly, edge, value-pick draft
src/lib/odds/value-picks-service.ts
src/lib/odds/fetch.ts          # The Odds API → OddsSnapshot
src/lib/odds/settle.ts         # settlement + CLV
src/lib/calibration.ts         # audits + buckets
src/lib/ingest.ts              # main data refresh
```

This README is meant to stay aligned with the code; if behavior changes, update the relevant section and `**MODEL_VERSION**` / constants when you ship breaking model changes.