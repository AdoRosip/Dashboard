"use client";

import clsx from "clsx";

interface PlayerStats {
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  minutes: number;
  xgPer90: number;
  xaPer90: number;
}

interface Injury {
  type: string;
  bodyPart: string | null;
  severity: string | null;
  expectedReturn: string | null;
  status: string;
}

interface PlayerData {
  id: number;
  name: string;
  position: string | null;
  isKeyPlayer: boolean;
  seasonAgg: PlayerStats[];
  injuries: Injury[];
}

export function PlayerSection({ teamName, players }: { teamName: string; players: PlayerData[] }) {
  const topScorers = [...players]
    .filter((p) => p.seasonAgg.length > 0)
    .sort((a, b) => (b.seasonAgg[0]?.goals ?? 0) - (a.seasonAgg[0]?.goals ?? 0))
    .slice(0, 5);

  if (topScorers.length === 0) {
    return (
      <div>
        <h4 className="mb-2 text-sm font-medium text-text-secondary">{teamName}</h4>
        <p className="text-sm text-text-muted">No player data available</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-text-secondary">{teamName}</h4>
      <div className="space-y-1.5">
        {topScorers.map((p) => {
          const stats = p.seasonAgg[0];
          const injured = p.injuries.some((i) => i.status === "out" || i.status === "doubt");

          return (
            <div
              key={p.id}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2",
                injured ? "border border-loss/30 bg-loss/5" : "bg-bg-secondary/40",
              )}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  {p.isKeyPlayer && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">KEY</span>}
                  {injured && <span className="rounded bg-loss/20 px-1.5 py-0.5 text-[10px] font-bold text-loss">INJURED</span>}
                </div>
                <div className="text-[11px] text-text-muted">
                  {p.position ?? "Unknown"}
                  {injured && p.injuries[0] && (
                    <span className="ml-1 text-injury">
                      — {p.injuries[0].type}{p.injuries[0].bodyPart && ` (${p.injuries[0].bodyPart})`}
                      {p.injuries[0].expectedReturn && ` · back ${p.injuries[0].expectedReturn}`}
                    </span>
                  )}
                </div>
              </div>
              {stats && (
                <div className="flex gap-3 text-center">
                  <StatPill label="G" value={stats.goals} />
                  <StatPill label="A" value={stats.assists} />
                  {stats.xg > 0 && <StatPill label="xG" value={stats.xg} decimal />}
                  <StatPill label="Min" value={stats.minutes} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatPill({ label, value, decimal }: { label: string; value: number; decimal?: boolean }) {
  return (
    <div className="min-w-[36px]">
      <div className="text-xs font-semibold text-text-primary">{decimal ? value.toFixed(1) : value}</div>
      <div className="text-[9px] uppercase text-text-muted">{label}</div>
    </div>
  );
}
