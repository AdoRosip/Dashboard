import { DEFAULT_UPCOMING_DAYS } from "../lib/constants";
import { runOddsCaptureCycle } from "../lib/odds";

function parseAheadDays(): number {
  const raw = Number(process.env.AHEAD_DAYS ?? DEFAULT_UPCOMING_DAYS);
  return Number.isFinite(raw) ? raw : DEFAULT_UPCOMING_DAYS;
}

void (async () => {
  const result = await runOddsCaptureCycle({
    days: parseAheadDays(),
    recomputeValuePicks: process.env.SKIP_VALUE_PICKS !== "true",
    includeReadiness: process.env.SKIP_READINESS !== "true",
  });

  console.log(JSON.stringify(result, null, 2));
})();
