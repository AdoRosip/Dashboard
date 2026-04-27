import { DEFAULT_UPCOMING_DAYS, MAX_UPCOMING_DAYS } from "../constants";
import { buildResearchReadinessReport } from "../research/readiness";
import { refreshOddsForUpcomingFixtures, type FetchOddsResult } from "./fetch";
import { recomputeValuePicksForUpcoming } from "./value-picks-service";

function clampAheadDays(days: number): number {
  return Math.min(Math.max(1, Math.floor(days)), MAX_UPCOMING_DAYS);
}

export interface OddsCaptureCycleOptions {
  days?: number;
  recomputeValuePicks?: boolean;
  includeReadiness?: boolean;
}

export interface OddsCaptureCycleResult {
  daysAhead: number;
  capturedAt: string;
  results: FetchOddsResult[];
  valuePicksUpdated: number | null;
  readiness:
    | Awaited<ReturnType<typeof buildResearchReadinessReport>>
    | null;
}

export async function runOddsCaptureCycle(
  options?: OddsCaptureCycleOptions,
): Promise<OddsCaptureCycleResult> {
  const daysAhead = clampAheadDays(options?.days ?? DEFAULT_UPCOMING_DAYS);
  const shouldRecomputeValuePicks = options?.recomputeValuePicks ?? true;
  const includeReadiness = options?.includeReadiness ?? true;

  const results = await refreshOddsForUpcomingFixtures(daysAhead);
  const valuePicksUpdated = shouldRecomputeValuePicks
    ? await recomputeValuePicksForUpcoming(daysAhead)
    : null;
  const readiness = includeReadiness ? await buildResearchReadinessReport() : null;

  return {
    daysAhead,
    capturedAt: new Date().toISOString(),
    results,
    valuePicksUpdated,
    readiness,
  };
}
