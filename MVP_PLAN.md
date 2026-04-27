# MVP Plan

This document defines the concrete path from the current research-heavy state of the project to a narrow, defensible MVP.

The goal is not "best possible betting AI".
The goal is:

- a stable product
- a narrow recommendation scope
- transparent reasoning
- operational discipline
- a foundation that can be improved later without rewriting the whole app again

## MVP Definition

The MVP is:

- a football value-pick product for the top 5 domestic leagues
- focused on `1x2_home`, `1x2_draw`, and `1x2_away`
- with strict data-quality gating
- with transparent pick rationale
- with product-facing performance reporting
- with clear separation between trusted and experimental outputs

The MVP is not:

- a full-market betting platform
- an auto-betting system
- a broad all-leagues prediction suite
- an over/under-first product

## Current State

What already exists:

- ingestion and prediction pipeline
- value-pick generation and diagnostics
- candidate history and immutable decision logging
- feature store and research datasets
- append-only odds history
- direct odds capture cycle
- walk-forward evaluation framework
- trainable research models that are beginning to beat handcrafted baselines in parts of `1x2`

What is still missing for MVP:

- one frozen production scope and production policy
- one stable recommendation path for supported markets
- product-facing health/status gating
- user-facing performance and trust pages
- explicit experimental-vs-production separation
- a reliable daily publishing workflow

## MVP Scope

### Supported Competitions

- Premier League
- La Liga
- Bundesliga
- Serie A
- Ligue 1

### Supported Markets

- `1x2_home`
- `1x2_draw`
- `1x2_away`

### Experimental / Hidden From Main Recommendations

- `over25`
- any future totals markets
- BTTS
- any market with weak backtest support or poor data coverage

## Product Rules

Only show a pick if all of the following are true:

- market is in MVP supported markets
- competition is in MVP supported competitions
- prediction source is the production model/policy version
- odds are fresh enough
- odds coverage is sufficient
- market matching confidence is acceptable
- edge is above minimum threshold
- EV is above minimum threshold
- model confidence is above minimum threshold
- data-quality score is above minimum threshold

If any of those fail:

- do not show the pick on the main picks page
- either suppress it entirely or mark it experimental in research/admin views only

## Private Daily Workflow

For now, this is a private tool, not a public product. The daily operating flow should be:

1. Run `npm run mvp:prepare`
2. If the run succeeds and `canPublish` is `true`, use [value-picks](./src/app/value-picks/page.tsx) as the trusted production surface
3. If the run is blocked or degraded, inspect [value-picks/ops](./src/app/value-picks/ops/page.tsx) before trusting any picks
4. Use [results](./src/app/results/page.tsx) to review the current MVP production record
5. Use [model-performance](./src/app/model-performance/page.tsx) only for research, diagnostics, and model development

What `npm run mvp:prepare` is expected to do:

1. Refresh football data
2. Refresh Understat unless explicitly skipped
3. Refresh odds and recompute production value picks
4. Settle completed historical picks and refresh aggregates
5. Run the MVP health gate
6. Log the run to `DataRefreshLog` with:
   - timestamp
   - health state
   - pick count
   - production policy version
   - production routing version

Daily decision rule:

- trust `/value-picks` only after a successful `npm run mvp:prepare`
- if the health gate blocks production, do not use the main picks page for decisions until the blocker is resolved
- if the run is degraded but not blocked, use `/value-picks/ops` to understand the warning before acting

## Workstreams

### 1. Scope Freeze

Goal: stop the product from pretending to support more than it can defend.

Tasks:

1. Define a production config for:
   - supported competitions
   - supported markets
   - allowed bookmakers
   - minimum thresholds
2. Remove experimental markets from the primary picks UI.
3. Add explicit flags for:
   - `production`
   - `experimental`
   - `disabled`

Exit condition:

- the app has one clearly defined production recommendation scope

### 2. Production Policy Freeze

Goal: create one stable recommendation policy instead of a shifting blend of research logic.

Tasks:

1. Create a versioned production policy object or config file.
2. Freeze thresholds for MVP:
   - minimum edge
   - minimum EV
   - minimum confidence
   - minimum odds freshness
   - minimum bookmaker coverage
   - minimum data-quality score
3. Wire current value-pick generation to this production policy.
4. Store the production policy version on every accepted production pick.

Exit condition:

- every production pick can be traced to one fixed policy version

### 3. Production Model Selection

Goal: promote only the parts of the modeling stack that are actually defensible.

Tasks:

1. Choose per-market production sources:
   - `1x2_draw`: prefer calibrated research model if it remains stronger
   - `1x2_home`: prefer best out-of-sample performer
   - `1x2_away`: promote only if still competitive after final checks
   - `over25`: keep out of MVP recommendations
2. Add a market-to-model routing layer so the app can use different model sources by market.
3. Keep the old heuristic engine as fallback only where the new model is not yet better.
4. Make model version explicit in output and storage.

Exit condition:

- production recommendations are generated by an explicit market-specific model map

### 4. Data-Quality and Health Gating

Goal: never publish picks when the pipeline is unhealthy.

Tasks:

1. Create a product-facing health check that verifies:
   - odds capture freshness
   - prediction freshness
   - upcoming fixture coverage
   - unmatched odds count
   - historical readiness flags
2. Add hard stop rules:
   - stale odds capture
   - missing predictions
   - poor fixture matching
   - unsupported league/market
3. Expose health state in the UI and API.
4. Show degraded status when the system should not be trusted.

Exit condition:

- the product can refuse to publish picks when quality conditions are not met

### 5. Pick Rationale

Goal: make every production pick explainable.

Tasks:

1. For each production pick, show:
   - model probability
   - market implied probability
   - edge
   - EV
   - confidence
   - bookmaker and odds
   - data-quality score
   - top explanatory drivers
2. Ensure the same rationale fields exist in the API.
3. Keep wording direct and non-promotional.

Exit condition:

- every visible pick has a concrete reason for existing

### 6. Product-Facing Results Page

Goal: give users a simple, credible view of performance.

Tasks:

1. Build a dedicated results page showing:
   - total picks
   - win rate
   - ROI
   - profit/loss units
   - by market
   - by league
   - by month
2. Show sample size prominently.
3. Separate production results from experimental/research results.
4. If CLV becomes reliable later, add it as a separate line, not as fake precision today.

Exit condition:

- a user can understand product performance without opening research pages

### 7. Picks Page Simplification

Goal: make the product useful around one user story.

Primary user story:

- "show me today’s best supported picks and why they qualify"

Tasks:

1. Make the picks page the main product surface.
2. Show only:
   - supported picks
   - rationale
   - product status
   - refresh timestamp
3. Move research/debug content out of the primary page.
4. Remove clutter and unsupported markets from the main flow.

Exit condition:

- the main page feels like a focused product, not an internal dashboard

### 8. Experimental Separation

Goal: stop presenting all outputs as equally trustworthy.

Tasks:

1. Add status buckets:
   - `production`
   - `experimental`
   - `hidden`
2. Prevent experimental outputs from appearing in the primary recommendation surface.
3. Add internal/admin-only views for experimental markets and research reports.

Exit condition:

- the UI clearly separates trusted product outputs from ongoing experiments

### 9. Publishing Workflow

Goal: make daily operation reliable.

Required workflow:

1. ingest football data
2. capture odds
3. compute predictions
4. run production policy
5. publish production picks
6. settle historical results later

Tasks:

1. Create one MVP publish command or script.
2. Ensure it fails clearly if health checks fail.
3. Log each publish run with:
   - timestamps
   - pick count
   - health state
   - policy version
   - model versions
4. Add a daily cadence recommendation.

Exit condition:

- there is one repeatable publish path for MVP operations

### 10. Trust, Messaging, and Product Honesty

Goal: avoid overstating what the system can do.

Tasks:

1. Add product copy that says clearly:
   - this is a model-driven value-pick tool
   - not every fixture receives a pick
   - some markets remain experimental
   - profitability is not guaranteed
2. Make sample-size and scope limitations visible.
3. Avoid fake certainty in UI copy.

Exit condition:

- the product presents itself honestly and defensibly

## Release Threshold

The project reaches MVP threshold when all of the following are true:

- only supported leagues and `1x2` markets are shown in the main product flow
- one production policy version is active and stored
- one production model map is active and stored
- production picks are blocked when health checks fail
- every production pick has transparent rationale
- the product has a clean results page
- experimental outputs are separated from production outputs
- one publish workflow can run end to end reliably

## Suggested Execution Order

This is the order to implement.

1. Scope freeze
2. Production policy freeze
3. Production model selection and routing
4. Health gating
5. Pick rationale cleanup
6. Simplified picks page
7. Product-facing results page
8. Experimental separation
9. MVP publish workflow
10. Trust and messaging cleanup

## Immediate Next Step

Start with:

- scope freeze
- production policy file
- supported market/league gating

Reason:

- there is no point polishing UI or publishing flows until the product knows exactly what it supports.
