"use client";

import clsx from "clsx";
import type { PredictionData } from "./match-dashboard";

export function PredictionSummary({
  prediction,
  homeName,
  awayName,
}: {
  prediction: PredictionData;
  homeName: string;
  awayName: string;
}) {
  const { probHomeWin, probDraw, probAwayWin, topScorelines } = prediction;
  const hp = Math.round(probHomeWin * 100);
  const dp = Math.round(probDraw * 100);
  const ap = Math.round(probAwayWin * 100);

  const mostLikely = topScorelines[0];

  return (
    <div className="my-3 flex flex-col items-center gap-3">
      {/* 1X2 Segmented Bar */}
      <div className="w-full max-w-xs">
        <div className="flex h-8 overflow-hidden rounded-lg text-xs font-bold">
          <div
            className="flex items-center justify-center bg-accent text-white transition-all"
            style={{ width: `${hp}%` }}
          >
            {hp > 10 && `${hp}%`}
          </div>
          <div
            className="flex items-center justify-center bg-draw/80 text-black transition-all"
            style={{ width: `${dp}%` }}
          >
            {dp > 10 && `${dp}%`}
          </div>
          <div
            className="flex items-center justify-center bg-loss/80 text-white transition-all"
            style={{ width: `${ap}%` }}
          >
            {ap > 10 && `${ap}%`}
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-text-muted">
          <span>{homeName}</span>
          <span>Draw</span>
          <span>{awayName}</span>
        </div>
      </div>

      {/* Most likely scoreline */}
      {mostLikely && (
        <div className="text-center">
          <div className="text-xl font-bold text-text-primary">
            {mostLikely.home} - {mostLikely.away}
          </div>
          <div className="text-xs text-text-muted">
            Most likely ({(mostLikely.prob * 100).toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Expected goals */}
      <div className="flex gap-4 text-xs text-text-muted">
        <span>
          xG: <span className="font-semibold text-text-secondary">{prediction.lambdaHome.toFixed(1)}</span>
          {" - "}
          <span className="font-semibold text-text-secondary">{prediction.lambdaAway.toFixed(1)}</span>
        </span>
        <span>
          Total: <span className="font-semibold text-text-secondary">{prediction.expectedTotalGoals.toFixed(1)}</span>
        </span>
      </div>

      {/* Confidence badge */}
      <div
        className={clsx(
          "rounded-full px-3 py-0.5 text-[10px] font-semibold",
          prediction.modelConfidence > 0.7
            ? "bg-win/15 text-win"
            : prediction.modelConfidence > 0.4
              ? "bg-draw/15 text-draw"
              : "bg-text-muted/15 text-text-muted",
        )}
      >
        {prediction.modelConfidence > 0.7
          ? "High Confidence"
          : prediction.modelConfidence > 0.4
            ? "Medium Confidence"
            : "Low Confidence"}
      </div>
    </div>
  );
}
