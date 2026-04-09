"use client";

import clsx from "clsx";
import type { PredictionData } from "./match-dashboard";

export function MarketProbabilities({ prediction }: { prediction: PredictionData }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {/* Over/Under */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Over / Under Goals
        </h4>
        <div className="space-y-1.5">
          {[
            { label: "Over 0.5", prob: prediction.probOver05 },
            { label: "Over 1.5", prob: prediction.probOver15 },
            { label: "Over 2.5", prob: prediction.probOver25 },
            { label: "Over 3.5", prob: prediction.probOver35 },
            { label: "Over 4.5", prob: prediction.probOver45 },
          ].map((row) => (
            <ProbBar key={row.label} label={row.label} prob={row.prob} />
          ))}
        </div>
      </div>

      {/* BTTS + Clean Sheet */}
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Both Teams to Score
          </h4>
          <div className="flex gap-3">
            <DonutMini label="Yes" prob={prediction.probBttsYes} color="bg-win" />
            <DonutMini label="No" prob={prediction.probBttsNo} color="bg-loss" />
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Clean Sheet
          </h4>
          <div className="flex gap-3">
            <DonutMini label="Home CS" prob={prediction.probHomeCs} color="bg-accent" />
            <DonutMini label="Away CS" prob={prediction.probAwayCs} color="bg-text-muted" />
          </div>
        </div>
      </div>

      {/* HT/FT */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Half-Time / Full-Time
        </h4>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(prediction.htFtProbabilities)
            .sort((a, b) => b[1] - a[1])
            .map(([key, prob]) => {
              const pct = prob * 100;
              return (
                <div
                  key={key}
                  className={clsx(
                    "flex flex-col items-center rounded-lg py-2",
                    pct > 15
                      ? "bg-accent/15 text-accent"
                      : pct > 5
                        ? "bg-bg-secondary/70 text-text-secondary"
                        : "bg-bg-secondary/30 text-text-muted",
                  )}
                >
                  <span className="text-xs font-bold">{key}</span>
                  <span className="text-[11px]">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function ProbBar({ label, prob }: { label: string; prob: number }) {
  const pct = Math.round(prob * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs text-text-secondary">{label}</span>
      <div className="flex-1">
        <div className="h-4 overflow-hidden rounded-full bg-bg-primary">
          <div
            className={clsx(
              "h-full rounded-full transition-all",
              pct > 60 ? "bg-win/70" : pct > 40 ? "bg-accent/60" : "bg-text-muted/40",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span
        className={clsx(
          "min-w-[40px] text-right text-xs font-semibold",
          pct > 60 ? "text-win" : pct > 40 ? "text-accent" : "text-text-muted",
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

function DonutMini({ label, prob, color }: { label: string; prob: number; color: string }) {
  const pct = Math.round(prob * 100);
  const circumference = 2 * Math.PI * 18;
  const dashArray = `${(prob * circumference).toFixed(1)} ${circumference.toFixed(1)}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-12 w-12">
        <svg className="h-12 w-12 -rotate-90" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(30,58,95,0.3)" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            className={color}
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={dashArray}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-text-primary">
          {pct}%
        </div>
      </div>
      <span className="text-[10px] text-text-muted">{label}</span>
    </div>
  );
}
