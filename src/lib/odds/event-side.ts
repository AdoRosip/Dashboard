/**
 * Maps h2h / 1X2 decimal odds from The Odds API event orientation onto our fixture’s
 * home / draw / away slots (outcome1 / outcome2 / outcome3 in `OddsSnapshot`).
 *
 * `ordered` must be [price for event home, draw, price for event away] as returned by
 * `orderH2hPrices(eventHome, eventAway, outcomes)`.
 */
export function remapH2hTripleToFixtureOrientation(
  orderedEventHomeDrawAway: [number, number, number],
  eventIsSwappedVsFixture: boolean,
): [number, number, number] {
  if (!eventIsSwappedVsFixture) return orderedEventHomeDrawAway;
  const [eventHomePx, drawPx, eventAwayPx] = orderedEventHomeDrawAway;
  return [eventAwayPx, drawPx, eventHomePx];
}
