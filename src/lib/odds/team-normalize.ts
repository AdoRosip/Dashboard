/** Shared string normalization for matching Odds API team labels to DB team names. */

export function normalizeTeamName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function namesFuzzyMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Whether an Odds API event refers to the same fixture as our DB row (either orientation).
 */
export function teamsMatchOddsEvent(
  dbHome: string,
  dbAway: string,
  oddsHome: string,
  oddsAway: string,
): boolean {
  const direct =
    namesFuzzyMatch(dbHome, oddsHome) && namesFuzzyMatch(dbAway, oddsAway);
  const swapped =
    namesFuzzyMatch(dbAway, oddsHome) && namesFuzzyMatch(dbHome, oddsAway);
  return direct || swapped;
}

/**
 * When `teamsMatchOddsEvent` is true, indicates whether the bookmaker lists home/away
 * opposite to our `Fixture` (DB) home/away. Used to remap 1X2 prices to fixture orientation.
 */
export function isOddsEventSwappedVsFixture(
  dbHome: string,
  dbAway: string,
  eventHome: string,
  eventAway: string,
): boolean {
  const direct =
    namesFuzzyMatch(dbHome, eventHome) && namesFuzzyMatch(dbAway, eventAway);
  const swapped =
    namesFuzzyMatch(dbAway, eventHome) && namesFuzzyMatch(dbHome, eventAway);
  if (direct && !swapped) return false;
  if (swapped && !direct) return true;
  return false;
}
