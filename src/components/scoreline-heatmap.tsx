"use client";

import clsx from "clsx";

export function ScorelineHeatmap({
  scorelines,
  topScorelines,
  homeName,
  awayName,
}: {
  scorelines: Record<string, number>;
  topScorelines: Array<{ home: number; away: number; prob: number }>;
  homeName: string;
  awayName: string;
}) {
  const maxGoals = 6;
  const maxProb = Math.max(...Object.values(scorelines), 0.001);

  return (
    <div className="space-y-4">
      {/* Heatmap Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[360px]">
          {/* Column headers (away goals) */}
          <div className="mb-1 flex">
            <div className="w-16 shrink-0" />
            {Array.from({ length: maxGoals }, (_, j) => (
              <div key={j} className="flex-1 text-center text-xs font-semibold text-text-muted">
                {j}
              </div>
            ))}
          </div>

          {/* Rows (home goals) */}
          {Array.from({ length: maxGoals }, (_, i) => (
            <div key={i} className="flex gap-0.5 mb-0.5">
              <div className="flex w-16 shrink-0 items-center justify-end pr-2 text-xs font-semibold text-text-muted">
                {i === 0 && <span className="mr-1 text-[10px] text-text-muted">{homeName}</span>}
                {i}
              </div>
              {Array.from({ length: maxGoals }, (_, j) => {
                const key = `${i}-${j}`;
                const prob = scorelines[key] ?? 0;
                const intensity = prob / maxProb;
                const isTopScore = topScorelines[0]?.home === i && topScorelines[0]?.away === j;

                return (
                  <div
                    key={key}
                    className={clsx(
                      "group relative flex flex-1 items-center justify-center rounded py-2.5 text-[11px] font-medium transition-all",
                      isTopScore && "ring-2 ring-accent",
                      prob > 0 ? "cursor-default" : "opacity-30",
                    )}
                    style={{
                      backgroundColor: prob > 0
                        ? `rgba(59, 130, 246, ${0.1 + intensity * 0.7})`
                        : "rgba(30, 41, 59, 0.3)",
                      color: intensity > 0.5 ? "white" : "rgba(148, 163, 184, 1)",
                    }}
                    title={`${i}-${j}: ${(prob * 100).toFixed(1)}%`}
                  >
                    {prob >= 0.01 ? `${(prob * 100).toFixed(0)}%` : prob > 0 ? "<1%" : ""}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Away label */}
          <div className="flex">
            <div className="w-16 shrink-0" />
            <div className="flex-1 text-center text-[10px] text-text-muted mt-1">
              {awayName} goals →
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 Most Likely Scorelines */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Most Likely Scorelines
        </h4>
        <div className="flex flex-wrap gap-2">
          {topScorelines.slice(0, 8).map((s, i) => {
            const isHomeWin = s.home > s.away;
            const isDraw = s.home === s.away;
            return (
              <div
                key={i}
                className={clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-2",
                  i === 0
                    ? "border border-accent/30 bg-accent/10"
                    : "bg-bg-secondary/60",
                )}
              >
                <span className="text-sm font-bold text-text-primary">
                  {s.home}-{s.away}
                </span>
                <span className="text-xs text-text-muted">
                  {(s.prob * 100).toFixed(1)}%
                </span>
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    isHomeWin ? "bg-accent" : isDraw ? "bg-draw" : "bg-loss",
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
