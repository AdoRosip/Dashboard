"use client";

import { format, parseISO } from "date-fns";
import clsx from "clsx";

interface Team {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
}

interface FormMatch {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  utcDate: string;
  scoreHomeFt: number | null;
  scoreAwayFt: number | null;
  winner: string | null;
  homeTeam: Team;
  awayTeam: Team;
}

function getResult(match: FormMatch, teamId: number): "W" | "D" | "L" | null {
  if (match.scoreHomeFt == null || match.scoreAwayFt == null) return null;
  if (match.winner === "DRAW") return "D";
  const isHome = match.homeTeamId === teamId;
  if (isHome) return match.winner === "HOME" ? "W" : "L";
  return match.winner === "AWAY" ? "W" : "L";
}

function getTeamGoals(match: FormMatch, teamId: number) {
  if (match.scoreHomeFt == null || match.scoreAwayFt == null) return null;
  return match.homeTeamId === teamId ? match.scoreHomeFt : match.scoreAwayFt;
}

function getOpponentGoals(match: FormMatch, teamId: number) {
  if (match.scoreHomeFt == null || match.scoreAwayFt == null) return null;
  return match.homeTeamId === teamId ? match.scoreAwayFt : match.scoreHomeFt;
}

const resultColors = {
  W: "bg-win text-white",
  D: "bg-draw text-black",
  L: "bg-loss text-white",
};

export function FormStrip({ matches, teamId }: { matches: FormMatch[]; teamId: number }) {
  if (matches.length === 0) {
    return <p className="text-sm text-text-muted">No recent results available</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {matches.map((m) => {
          const result = getResult(m, teamId);
          if (!result) return null;
          return (
            <div
              key={m.id}
              className={clsx("flex h-7 w-7 items-center justify-center rounded text-xs font-bold", resultColors[result])}
              title={`${m.homeTeam.tla ?? m.homeTeam.shortName} ${m.scoreHomeFt}-${m.scoreAwayFt} ${m.awayTeam.tla ?? m.awayTeam.shortName}`}
            >
              {result}
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        {matches.map((m) => {
          const result = getResult(m, teamId);
          const teamGoals = getTeamGoals(m, teamId);
          const oppGoals = getOpponentGoals(m, teamId);
          const opponent = m.homeTeamId === teamId ? m.awayTeam : m.homeTeam;
          const venue = m.homeTeamId === teamId ? "H" : "A";

          return (
            <div key={m.id} className="flex items-center gap-2 text-xs text-text-secondary">
              <span className={clsx("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", result ? resultColors[result] : "bg-bg-secondary text-text-muted")}>
                {result ?? "?"}
              </span>
              <span className="w-20 truncate text-text-primary">{opponent.tla ?? opponent.shortName ?? opponent.name}</span>
              <span className="font-mono text-text-primary">{teamGoals ?? "?"}-{oppGoals ?? "?"}</span>
              <span className="text-text-muted">({venue})</span>
              <span className="ml-auto text-text-muted">{format(parseISO(m.utcDate), "MMM d")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
