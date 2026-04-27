import Link from "next/link";
import { prisma } from "@/lib/db";
import { FIXTURE_STATUS_LIVE } from "@/lib/odds/fixture-pick-status";
import { getMvpProductHealth } from "@/lib/mvp/health";
import { attachValuePickRationale } from "@/lib/mvp/pick-rationale";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "@/lib/mvp/config";
import { PicksTable, type ValuePickRow } from "./shared";
import { SurfaceBadge } from "@/components/surface-badge";

export const dynamic = "force-dynamic";

const pickInclude = {
  fixture: {
    include: { homeTeam: true, awayTeam: true, competition: true },
  },
} as const;

export default async function ValuePicksPage() {
  const now = new Date();
  const [health, activePicksRaw, perf, settledWithClvCount] = await Promise.all([
    getMvpProductHealth(),
    prisma.valuePick.findMany({
      where: {
        market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
        settled: false,
        OR: [
          {
            fixture: {
              competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
              status: { in: [...FIXTURE_STATUS_LIVE] },
            },
          },
          {
            fixture: {
              competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] },
              utcDate: { gt: now },
            },
          },
        ],
      },
      orderBy: [{ edge: "desc" }],
      include: pickInclude,
      take: 100,
    }),
    prisma.bettingPerformance.findFirst({
      where: { period: "all_time", market: "all", league: "all" },
    }),
    prisma.valuePick.count({
      where: {
        settled: true,
        market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
        fixture: { competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] } },
        closingLineValue: { not: null },
      },
    }),
  ]);

  const activeWithRationale = await attachValuePickRationale(activePicksRaw);
  const activePicks = (health.canPublish ? activeWithRationale : []) as unknown as ValuePickRow[];

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3">
          <SurfaceBadge tone="production" label="Production Surface" />
        </div>
        <h1 className="text-2xl font-semibold text-text-primary">Value picks</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Today’s supported production picks for the top 5 domestic leagues. This MVP surface only
          shows <code className="rounded bg-bg-card px-1">1x2</code> markets that clear the
          production scope, health gate, edge, EV, confidence, and data-quality checks.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-secondary">
          <span className="rounded bg-bg-card px-2 py-1">Scope: PL, PD, BL1, SA, FL1</span>
          <span className="rounded bg-bg-card px-2 py-1">Markets: 1x2 home / draw / away</span>
          <span className="rounded bg-bg-card px-2 py-1">
            Refreshed {new Date(health.generatedAt).toLocaleString()}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/value-picks/ops" className="text-accent hover:underline">
            Open ops view
          </Link>
          <Link href="/results" className="text-accent hover:underline">
            Results
          </Link>
          <Link href="/api/value-picks" className="text-accent hover:underline">
            Raw picks JSON
          </Link>
        </div>
      </div>

      <section
        className={`rounded-xl border p-4 ${
          health.status === "healthy"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : health.status === "degraded"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-red-500/30 bg-red-500/5"
        }`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Product status</h2>
            <p className="mt-1 text-xs text-text-secondary">
              The main picks surface only publishes when the MVP health gate allows it.
            </p>
          </div>
          <Link href="/api/mvp/health" className="text-xs text-accent hover:underline">
            Health JSON
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              health.status === "healthy"
                ? "bg-emerald-500/15 text-emerald-300"
                : health.status === "degraded"
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-red-500/15 text-red-300"
            }`}
          >
            {health.status.toUpperCase()}
          </span>
          <span className="text-xs text-text-secondary">
            Publish {health.canPublish ? "enabled" : "blocked"}
          </span>
          <span className="text-xs text-text-secondary">
            Coverage {(health.summary.upcomingOddsCoverage * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-text-secondary">
            Prediction {(health.summary.predictionCoverage * 100).toFixed(0)}%
          </span>
        </div>
        {health.blockers.length > 0 && (
          <div className="mt-4 space-y-1 text-xs text-red-300">
            {health.blockers.map((blocker) => (
              <p key={blocker}>{blocker}</p>
            ))}
          </div>
        )}
        {health.warnings.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-amber-200">
            {health.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </section>

      {perf && (
        <section className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-text-primary">Current record</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Product-facing summary. Deeper diagnostics stay in the ops and research views.
              </p>
            </div>
            <Link href="/results" className="text-xs text-accent hover:underline">
              Full results
            </Link>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="text-text-secondary">ROI</dt>
              <dd className="font-mono text-text-primary">{perf.roi.toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Total P/L</dt>
              <dd
                className={`font-mono ${
                  perf.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {perf.profitLoss >= 0 ? "+" : ""}
                {perf.profitLoss.toFixed(2)}u
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">Avg CLV</dt>
              <dd className="font-mono text-text-primary">
                {settledWithClvCount === 0 ? "—" : `${(perf.avgClosingLineValue * 100).toFixed(2)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">Hit rate</dt>
              <dd className="font-mono text-text-primary">{(perf.hitRate * 100).toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Picks</dt>
              <dd className="font-mono text-text-primary">{perf.totalPicks}</dd>
            </div>
          </dl>
        </section>
      )}

      <PicksTable
        title="Active picks"
        subtitle="Matches not started yet or currently live. Each row shows the exact reason it passed the MVP production filter."
        picks={activePicks}
        emptyMessage={
          health.canPublish
            ? "No active picks cleared the current MVP production gates."
            : "Production publication is blocked by the health gate. Check the ops view for details."
        }
      />
    </div>
  );
}
