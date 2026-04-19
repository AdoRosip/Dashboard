/**
 * One command for day-to-day operation (run manually, cron, or Task Scheduler):
 *
 *   npm run daily
 *
 * Wraps `refreshAll`: Football-Data ingest (fixtures + recent results + standings/scorers),
 * Understat xG (unless SKIP_UNDERSTAT=true), derived stats + H2H, V2 prediction pipeline,
 * odds refresh + value picks (needs ODDS_API_KEY), then settle picks + betting aggregates.
 *
 * Lookahead is capped at **48h** (2 calendar days) — see `MAX_UPCOMING_DAYS` in `constants.ts`.
 *
 * Env (optional overrides):
 *   AHEAD_DAYS=2        — upcoming window (clamped to max 2 days)
 *   RESULTS_DAYS=7      — how far back to pull finished scores (default 7)
 *   SKIP_UNDERSTAT=true — skip Understat scrape
 *
 * Optional extras not included here: `npm run calibration:run` (audit buckets), `npm run ingest:understat` alone.
 */

import { DEFAULT_UPCOMING_DAYS } from "../lib/constants";
import { refreshAll } from "../lib/ingest";

async function main() {
  const aheadDays = Math.max(1, Number(process.env.AHEAD_DAYS ?? DEFAULT_UPCOMING_DAYS));
  const resultsDaysBack = Math.max(1, Number(process.env.RESULTS_DAYS ?? 7));
  const skipUnderstat = process.env.SKIP_UNDERSTAT === "true";

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Daily run — fixtures, model, odds, value picks, settle   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(
    `  Lookahead: ${aheadDays}d (max 48h)  |  Results back: ${resultsDaysBack}d  |  Understat: ${skipUnderstat ? "off" : "on"}`,
  );
  console.log("");

  await refreshAll({ aheadDays, resultsDaysBack, skipUnderstat });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
