"use client";

import { format, parseISO } from "date-fns";
import clsx from "clsx";

interface Team {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
}

interface Competition {
  id: string;
  name: string;
}

interface H2HMatch {
  id: number;
  teamAId: number;
  teamBId: number;
  date: string;
  scoreA: number;
  scoreB: number;
  competition: Competition | null;
}

export function H2HSection({
  h2h,
  homeTeam,
  awayTeam,
}: {
  h2h: H2HMatch[];
  homeTeam: Team;
  awayTeam: Team;
}) {
  if (h2h.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-text-muted">
        No head-to-head records found
      </p>
    );
  }

  const homeId = homeTeam.id;
  const awayId = awayTeam.id;

  let homeWins = 0,
    awayWins = 0,
    draws = 0,
    totalGoals = 0;

  for (const m of h2h) {
    const homeScore = m.teamAId === homeId ? m.scoreA : m.scoreB;
    const awayScore = m.teamAId === homeId ? m.scoreB : m.scoreA;
    totalGoals += homeScore + awayScore;
    if (homeScore > awayScore) homeWins++;
    else if (homeScore < awayScore) awayWins++;
    else draws++;
  }

  const avgGoals = (totalGoals / h2h.length).toFixed(1);

  return (
    <div>
      {/* Summary */}
      <div className="mb-4 flex items-center justify-center gap-6 rounded-lg bg-bg-secondary/60 px-4 py-3">
        <div className="text-center">
          <div className="text-lg font-bold text-win">{homeWins}</div>
          <div className="text-[10px] uppercase text-text-muted">
            {homeTeam.tla ?? homeTeam.shortName} Wins
          </div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-draw">{draws}</div>
          <div className="text-[10px] uppercase text-text-muted">Draws</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-loss">{awayWins}</div>
          <div className="text-[10px] uppercase text-text-muted">
            {awayTeam.tla ?? awayTeam.shortName} Wins
          </div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="text-center">
          <div className="text-lg font-bold text-text-primary">{avgGoals}</div>
          <div className="text-[10px] uppercase text-text-muted">
            Avg Goals
          </div>
        </div>
      </div>

      {/* Match list */}
      <div className="space-y-1">
        {h2h.map((m) => {
          const homeScore = m.teamAId === homeId ? m.scoreA : m.scoreB;
          const awayScore = m.teamAId === homeId ? m.scoreB : m.scoreA;
          const result =
            homeScore > awayScore
              ? "home"
              : homeScore < awayScore
                ? "away"
                : "draw";

          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg bg-bg-secondary/40 px-3 py-2 text-xs"
            >
              <span className="w-16 text-text-muted">
                {format(parseISO(m.date), "MMM d, yy")}
              </span>
              <span
                className={clsx(
                  "w-24 text-right font-medium",
                  result === "home"
                    ? "text-win"
                    : result === "draw"
                      ? "text-text-primary"
                      : "text-text-secondary",
                )}
              >
                {homeTeam.tla ?? homeTeam.shortName}
              </span>
              <span className="w-12 text-center font-mono font-bold text-text-primary">
                {homeScore} - {awayScore}
              </span>
              <span
                className={clsx(
                  "w-24 font-medium",
                  result === "away"
                    ? "text-win"
                    : result === "draw"
                      ? "text-text-primary"
                      : "text-text-secondary",
                )}
              >
                {awayTeam.tla ?? awayTeam.shortName}
              </span>
              {m.competition && (
                <span className="ml-auto text-text-muted">
                  {m.competition.name}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
