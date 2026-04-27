export const SNAPSHOT_TRUST_LEVELS = [
  "forward_safe",
  "reconstructed_safe",
  "unsafe_reconstructed",
] as const;

export type SnapshotTrust = (typeof SNAPSHOT_TRUST_LEVELS)[number];

export const DEFAULT_SNAPSHOT_TRUST: SnapshotTrust = "unsafe_reconstructed";
export const SAFE_RESEARCH_SNAPSHOT_TRUST_LEVELS = [
  "forward_safe",
  "reconstructed_safe",
] as const satisfies readonly SnapshotTrust[];

export const LEGACY_FEATURE_BUILDER_LEAKAGE_WARNING =
  "Snapshot was built by the legacy feature builder; mutable current-state aggregates may leak post-kickoff information.";

export function isSnapshotTrust(value: string): value is SnapshotTrust {
  return SNAPSHOT_TRUST_LEVELS.includes(value as SnapshotTrust);
}

export function leakageWarningsJson(warnings: string[]): string {
  return JSON.stringify(Array.from(new Set(warnings)));
}

export const FEATURE_SOURCE_SNAPSHOT_SOURCES = [
  "fixture_metadata",
  "team_season_stats",
  "team_recent_match_stats",
  "team_squad_state",
  "h2h_history",
  "v2_context",
  "odds_observations",
  "derived_feature_payload",
] as const;

export type FeatureSourceSnapshotSource =
  (typeof FEATURE_SOURCE_SNAPSHOT_SOURCES)[number];
