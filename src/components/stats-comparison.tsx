"use client";

import clsx from "clsx";

interface TeamStats {
  matchesPlayed: number;
  goalsScored: number;
  goalsConceded: number;
  goalsHome: number;
  goalsAway: number;
  concededHome: number;
  concededAway: number;
  xgFor: number;
  xgAgainst: number;
  xgHome: number;
  xgAway: number;
  cleanSheets: number;
  bttsCount: number;
  over25Count: number;
  matchesPlayedHome: number;
  matchesPlayedAway: number;
}

interface StatRow {
  label: string;
  homeValue: number;
  awayValue: number;
  format?: "decimal" | "percent" | "integer";
  higherIsBetter?: boolean;
}

export function StatsComparison({
  homeStats,
  awayStats,
  homeName,
  awayName,
}: {
  homeStats: TeamStats | null;
  awayStats: TeamStats | null;
  homeName: string;
  awayName: string;
}) {
  if (!homeStats && !awayStats) {
    return (
      <div className="py-8 text-center text-sm text-text-muted">
        No stats available yet. Run data refresh to populate.
      </div>
    );
  }

  const hs = homeStats;
  const as_ = awayStats;

  const safe = (v: number | undefined) => v ?? 0;
  const perGame = (v: number | undefined, gp: number | undefined) =>
    gp && gp > 0 ? safe(v) / gp : 0;

  const rows: StatRow[] = [
    {
      label: "Goals / Game",
      homeValue: perGame(hs?.goalsScored, hs?.matchesPlayed),
      awayValue: perGame(as_?.goalsScored, as_?.matchesPlayed),
      format: "decimal",
      higherIsBetter: true,
    },
    {
      label: "Goals / Game (Home/Away)",
      homeValue: perGame(hs?.goalsHome, hs?.matchesPlayedHome),
      awayValue: perGame(as_?.goalsAway, as_?.matchesPlayedAway),
      format: "decimal",
      higherIsBetter: true,
    },
    {
      label: "Conceded / Game",
      homeValue: perGame(hs?.goalsConceded, hs?.matchesPlayed),
      awayValue: perGame(as_?.goalsConceded, as_?.matchesPlayed),
      format: "decimal",
      higherIsBetter: false,
    },
    {
      label: "Conceded / Game (Home/Away)",
      homeValue: perGame(hs?.concededHome, hs?.matchesPlayedHome),
      awayValue: perGame(as_?.concededAway, as_?.matchesPlayedAway),
      format: "decimal",
      higherIsBetter: false,
    },
    {
      label: "xG / Game",
      homeValue: perGame(hs?.xgFor, hs?.matchesPlayed),
      awayValue: perGame(as_?.xgFor, as_?.matchesPlayed),
      format: "decimal",
      higherIsBetter: true,
    },
    {
      label: "xG Against / Game",
      homeValue: perGame(hs?.xgAgainst, hs?.matchesPlayed),
      awayValue: perGame(as_?.xgAgainst, as_?.matchesPlayed),
      format: "decimal",
      higherIsBetter: false,
    },
    {
      label: "Clean Sheet %",
      homeValue: hs?.matchesPlayed
        ? (safe(hs.cleanSheets) / hs.matchesPlayed) * 100
        : 0,
      awayValue: as_?.matchesPlayed
        ? (safe(as_.cleanSheets) / as_.matchesPlayed) * 100
        : 0,
      format: "percent",
      higherIsBetter: true,
    },
    {
      label: "BTTS %",
      homeValue: hs?.matchesPlayed
        ? (safe(hs.bttsCount) / hs.matchesPlayed) * 100
        : 0,
      awayValue: as_?.matchesPlayed
        ? (safe(as_.bttsCount) / as_.matchesPlayed) * 100
        : 0,
      format: "percent",
    },
    {
      label: "Over 2.5 %",
      homeValue: hs?.matchesPlayed
        ? (safe(hs.over25Count) / hs.matchesPlayed) * 100
        : 0,
      awayValue: as_?.matchesPlayed
        ? (safe(as_.over25Count) / as_.matchesPlayed) * 100
        : 0,
      format: "percent",
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-muted">
        <span>{homeName}</span>
        <span>{awayName}</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <StatBar key={row.label} row={row} />
        ))}
      </div>
    </div>
  );
}

function StatBar({ row }: { row: StatRow }) {
  const maxVal = Math.max(row.homeValue, row.awayValue, 0.01);

  const formatVal = (v: number) => {
    if (row.format === "percent") return `${v.toFixed(0)}%`;
    if (row.format === "integer") return v.toFixed(0);
    return v.toFixed(2);
  };

  const homePct = (row.homeValue / maxVal) * 100;
  const awayPct = (row.awayValue / maxVal) * 100;

  const homeWins =
    row.higherIsBetter !== undefined
      ? row.higherIsBetter
        ? row.homeValue > row.awayValue
        : row.homeValue < row.awayValue
      : false;
  const awayWins =
    row.higherIsBetter !== undefined
      ? row.higherIsBetter
        ? row.awayValue > row.homeValue
        : row.awayValue < row.homeValue
      : false;

  return (
    <div className="group rounded-lg bg-bg-secondary/40 px-3 py-2 transition-colors hover:bg-bg-secondary/70">
      <div className="mb-1 text-center text-[11px] text-text-muted">
        {row.label}
      </div>
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "min-w-[48px] text-right text-sm font-semibold",
            homeWins ? "text-win" : "text-text-primary",
          )}
        >
          {formatVal(row.homeValue)}
        </span>

        <div className="flex flex-1 gap-1">
          <div className="flex h-3 flex-1 justify-end overflow-hidden rounded-full bg-bg-primary">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                homeWins ? "bg-win/70" : "bg-accent/50",
              )}
              style={{ width: `${homePct}%` }}
            />
          </div>
          <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-bg-primary">
            <div
              className={clsx(
                "h-full rounded-full transition-all",
                awayWins ? "bg-win/70" : "bg-accent/50",
              )}
              style={{ width: `${awayPct}%` }}
            />
          </div>
        </div>

        <span
          className={clsx(
            "min-w-[48px] text-left text-sm font-semibold",
            awayWins ? "text-win" : "text-text-primary",
          )}
        >
          {formatVal(row.awayValue)}
        </span>
      </div>
    </div>
  );
}
