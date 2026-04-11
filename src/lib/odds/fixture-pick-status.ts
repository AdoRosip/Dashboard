/**
 * How to bucket unsettled value picks for the UI.
 *
 * `Fixture.status` from Football-Data.org often **lags**: a finished game can still show
 * SCHEDULED/TIMED until `ingest` runs again. So we must use **kickoff time** (`utcDate`),
 * not status alone.
 */

/** Match currently being played. */
export const FIXTURE_STATUS_LIVE = ["IN_PLAY", "PAUSED"] as const;

/** Terminal / no result yet — informational only; primary split uses `isValuePickActiveFixture`. */
export const FIXTURE_STATUS_FINAL = ["FINISHED", "AWARDED"] as const;

/** @deprecated use `isValuePickActiveFixture` — status-only bucketing is unreliable */
export const FIXTURE_STATUS_PRE_OR_LIVE = [
  "SCHEDULED",
  "TIMED",
  "IN_PLAY",
  "PAUSED",
] as const;

export type ValuePickUiBucket = "active" | "pending_settlement" | "other";

/**
 * A value pick is **active** (upcoming or live) if:
 * - the fixture is **in play**, or
 * - kickoff (`utcDate`) is still **strictly in the future**.
 *
 * Everything else (past kickoff, not live) is **not** active — typically finished games
 * with stale status, or FINISHED — and belongs in "pending settlement" until `settleValuePicks()`.
 */
export function isValuePickActiveFixture(f: { status: string; utcDate: Date }): boolean {
  if (f.status === "IN_PLAY" || f.status === "PAUSED") return true;
  return f.utcDate.getTime() > Date.now();
}

/** Bucket for display when you have full fixture fields (optional scores). */
export function valuePickFixtureBucket(
  f: { status: string; utcDate: Date },
): ValuePickUiBucket {
  if (isValuePickActiveFixture(f)) return "active";
  if (f.status === "POSTPONED" || f.status === "CANCELLED") return "other";
  return "pending_settlement";
}
