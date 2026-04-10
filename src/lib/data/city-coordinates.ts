/**
 * Tiered travel estimates (km) when exact geocoding is unavailable.
 * European away trips are direction-agnostic averages.
 */
export type TravelTier = "domestic" | "europe_regional" | "europe_long";

export function estimateTravelKmForAwayMatch(tier: TravelTier): number {
  switch (tier) {
    case "domestic":
      return 200;
    case "europe_regional":
      return 1500;
    case "europe_long":
      return 3500;
    default:
      return 200;
  }
}
