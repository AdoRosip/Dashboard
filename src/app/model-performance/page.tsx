import Link from "next/link";
import { prisma } from "@/lib/db";
import { meanHeadlineBrier } from "@/lib/calibration";
import { buildValueBacktestReport } from "@/lib/odds/backtest";
import { getCandidateHistory } from "@/lib/odds/candidate-history";
import { SurfaceBadge } from "@/components/surface-badge";
import {
  formatPickProfitLossDisplay,
  formatPickStakeDisplay,
  pickProfitLossNumericForUi,
} from "@/lib/odds/stake-units";

type SettledPickRow = {
  id: number;
  fixtureId: number;
  market: string;
  outcome: string | null;
  modelProb: number;
  bestOdds: number;
  edgePct: number;
  rating: number | null;
  profitLoss: number | null;
  settledAt: Date | null;
  stakeUnits: number | null;
  fixture: {
    competition: { name: string };
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
    scoreHomeFt: number | null;
    scoreAwayFt: number | null;
  };
};

export const dynamic = "force-dynamic";

export default async function ModelPerformancePage() {
  const [buckets, perf, audits, settledPicksRaw, backtest, candidateHistory] = await Promise.all([
    prisma.calibrationBucket.findMany({ orderBy: [{ market: "asc" }], take: 120 }),
    prisma.bettingPerformance.findMany({ take: 20 }),
    prisma.predictionAudit.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
    prisma.betDecision.findMany({
      where: { settled: true, outcome: { in: ["win", "loss"] } },
      orderBy: { settledAt: "desc" },
      take: 150,
      include: {
        fixture: {
          include: { homeTeam: true, awayTeam: true, competition: true },
        },
      },
    }),
    buildValueBacktestReport(),
    getCandidateHistory(60),
  ]);
  const settledPicks = settledPicksRaw as SettledPickRow[];

  const brierHeadline = meanHeadlineBrier(audits);
  const brierAll =
    audits.length > 0
      ? audits.reduce((s, a) => s + a.brierContribution, 0) / audits.length
      : null;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3">
          <SurfaceBadge tone="research" label="Research Surface" />
        </div>
        <h1 className="text-2xl font-semibold text-text-primary">Model performance</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Research, calibration, and model-development view. Do not use this page as the primary
          decision surface. Run{" "}
          <code className="rounded bg-bg-card px-1">POST /api/calibration/run</code> for
          model metrics and <code className="rounded bg-bg-card px-1">npm run betting:settle</code>{" "}
          (or <code className="rounded bg-bg-card px-1">POST /api/betting/settle</code>) to
          mark value picks after matches finish.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <h2 className="text-sm font-medium text-text-primary">Summary</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-secondary">Mean Brier (headline)</dt>
            <dd className="font-mono text-text-primary">
              {brierHeadline != null ? brierHeadline.toFixed(4) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Mean Brier (all audit rows)</dt>
            <dd className="font-mono text-text-primary">
              {brierAll != null ? brierAll.toFixed(4) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Audit rows</dt>
            <dd className="font-mono text-text-primary">{audits.length}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Calibration buckets</dt>
            <dd className="font-mono text-text-primary">{buckets.length}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Value pick backtest</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Historical graded picks grouped by edge, EV, confidence, and price. Use this before
              changing thresholds.
            </p>
          </div>
          <Link href="/api/value-picks/backtest" className="text-xs text-accent hover:underline">
            Raw backtest JSON
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-text-secondary">Graded picks</dt>
            <dd className="font-mono text-text-primary">{backtest.gradedPicks}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">ROI</dt>
            <dd className="font-mono text-text-primary">{backtest.overall.roi.toFixed(2)}%</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Hit rate</dt>
            <dd className="font-mono text-text-primary">
              {(backtest.overall.hitRate * 100).toFixed(1)}%
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Avg edge</dt>
            <dd className="font-mono text-text-primary">
              {backtest.overall.avgEdgePct.toFixed(2)}%
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Avg EV</dt>
            <dd className="font-mono text-text-primary">
              {backtest.overall.avgExpectedValuePct.toFixed(2)}%
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Avg confidence</dt>
            <dd className="font-mono text-text-primary">
              {backtest.overall.avgConfidencePct.toFixed(1)}%
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded bg-bg-card px-2 py-1 text-xs text-text-secondary">
            current min edge {(backtest.currentPolicy.minEdge * 100).toFixed(1)}%
          </span>
          <span className="rounded bg-bg-card px-2 py-1 text-xs text-text-secondary">
            current min EV {(backtest.currentPolicy.minExpectedValue * 100).toFixed(1)}%
          </span>
          <span className="rounded bg-bg-card px-2 py-1 text-xs text-text-secondary">
            current min confidence {(backtest.currentPolicy.minModelConfidence * 100).toFixed(0)}%
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Candidate history</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Recent immutable market evaluations across recompute runs. This is the accepted vs
              rejected universe the old app was missing.
            </p>
          </div>
          <Link href="/api/value-picks/history" className="text-xs text-accent hover:underline">
            Raw candidate history JSON
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-text-secondary">Logged accepted</dt>
            <dd className="font-mono text-text-primary">{candidateHistory.summary.accepted}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Logged rejected</dt>
            <dd className="font-mono text-text-primary">{candidateHistory.summary.rejected}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Tracked runs</dt>
            <dd className="font-mono text-text-primary">{candidateHistory.runs.length}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Latest run status</dt>
            <dd className="font-mono text-text-primary">
              {candidateHistory.runs[0]?.status ?? "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {candidateHistory.summary.topRejections.length === 0 ? (
            <span className="text-xs text-text-secondary">No rejection reasons logged yet.</span>
          ) : (
            candidateHistory.summary.topRejections.map((reason) => (
              <span
                key={reason.reason}
                className="rounded-full border border-border px-2 py-1 text-xs text-text-secondary"
              >
                {reason.reason}: {reason.count}
              </span>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Betting performance rows</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-bg-secondary text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">ROI</th>
                <th className="px-3 py-2">Total P/L</th>
                <th className="px-3 py-2">Avg CLV</th>
                <th className="px-3 py-2">Picks</th>
              </tr>
            </thead>
            <tbody>
              {perf.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-text-secondary">
                    No aggregates yet.
                  </td>
                </tr>
              ) : (
                perf.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2">{p.period}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.market} / {p.league}
                    </td>
                    <td className="px-3 py-2 font-mono">{p.roi.toFixed(2)}%</td>
                    <td
                      className={`px-3 py-2 font-mono ${
                        p.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {p.profitLoss >= 0 ? "+" : ""}
                      {p.profitLoss.toFixed(2)}u
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {(p.avgClosingLineValue * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 font-mono">{p.totalPicks}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Threshold sweeps</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <ThresholdTable
            title="Min edge"
            rows={backtest.thresholds.minEdgePct}
            suffix="%"
          />
          <ThresholdTable
            title="Min EV"
            rows={backtest.thresholds.minExpectedValuePct}
            suffix="%"
          />
          <ThresholdTable
            title="Min confidence"
            rows={backtest.thresholds.minConfidencePct}
            suffix="%"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Band analysis</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <BandTable title="Edge bands" rows={backtest.bands.edgePct} />
          <BandTable title="EV bands" rows={backtest.bands.expectedValuePct} />
          <BandTable title="Confidence bands" rows={backtest.bands.confidencePct} />
          <BandTable title="Odds bands" rows={backtest.bands.odds} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Recent candidate evaluations</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-bg-secondary text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2">Edge</th>
                <th className="px-3 py-2">EV</th>
                <th className="px-3 py-2">Conf</th>
                <th className="px-3 py-2">Odds</th>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {candidateHistory.recent.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-text-secondary">
                    No candidate evaluations logged yet.
                  </td>
                </tr>
              ) : (
                candidateHistory.recent.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/match/${row.fixtureId}`} className="text-accent hover:underline">
                        {row.homeTeam} vs {row.awayTeam}
                      </Link>
                      <div className="text-xs text-text-secondary">{row.competition}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.market}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.accepted
                            ? "rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400"
                            : "rounded bg-red-500/15 px-2 py-0.5 text-red-400"
                        }
                      >
                        {row.accepted ? "Accepted" : "Rejected"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{row.edgePct.toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{row.expectedValuePct.toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{row.confidencePct.toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{row.bestOdds.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-xs">#{row.runId}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {row.accepted ? "passed policy" : row.rejectionReasons.join(", ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Settled value picks</h2>
        <p className="mb-3 text-xs text-text-secondary">
          <strong>Stake</strong> and <strong>P/L</strong> use the same unit system (1u = your standard
          bet). P/L is from stake × result at the pick&apos;s decimal odds (win: U·(O−1), loss: −U). A
          trailing <strong>*</strong> on stake only means legacy quarter-Kelly was stored as 0. Run{" "}
          <code className="rounded bg-bg-card px-1">npm run betting:settle</code> to refresh aggregates.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-bg-secondary text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Odds</th>
                <th className="px-3 py-2">Edge</th>
                <th className="px-3 py-2">Stake</th>
                <th className="px-3 py-2">P/L</th>
                <th className="px-3 py-2">Settled</th>
              </tr>
            </thead>
            <tbody>
              {settledPicks.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-text-secondary">
                    No settled picks yet — run odds refresh, then settle after fixtures finish.
                  </td>
                </tr>
              ) : (
                settledPicks.map((p) => {
                  const f = p.fixture;
                  const home = f.homeTeam.shortName ?? f.homeTeam.name;
                  const away = f.awayTeam.shortName ?? f.awayTeam.name;
                  const score =
                    f.scoreHomeFt != null && f.scoreAwayFt != null
                      ? `${f.scoreHomeFt}–${f.scoreAwayFt}`
                      : "—";
                  const won = p.outcome === "win";
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          href={`/match/${p.fixtureId}`}
                          className="text-accent hover:underline"
                        >
                          {home} vs {away}
                        </Link>
                        <div className="text-xs text-text-secondary">{f.competition.name}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{p.market}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            won
                              ? "rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400"
                              : "rounded bg-red-500/15 px-2 py-0.5 text-red-400"
                          }
                        >
                          {won ? "Hit" : "Miss"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{score}</td>
                      <td className="px-3 py-2 font-mono">{(p.modelProb * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 font-mono">{p.bestOdds.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">+{p.edgePct.toFixed(1)}%</td>
                      <td className="px-3 py-2 font-mono">
                        {formatPickStakeDisplay({
                          stakeUnits: p.stakeUnits,
                          quarterKelly: 0,
                          rating: p.rating ?? 1,
                          modelProb: p.modelProb,
                          bestOdds: p.bestOdds,
                        })}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono ${
                          pickProfitLossNumericForUi({
                            stakeUnits: p.stakeUnits,
                            profitLoss: p.profitLoss,
                            quarterKelly: 0,
                            rating: p.rating ?? 1,
                            modelProb: p.modelProb,
                            bestOdds: p.bestOdds,
                            outcome: p.outcome,
                          }) >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {formatPickProfitLossDisplay({
                          stakeUnits: p.stakeUnits,
                          profitLoss: p.profitLoss,
                          quarterKelly: 0,
                          rating: p.rating ?? 1,
                          modelProb: p.modelProb,
                          bestOdds: p.bestOdds,
                          outcome: p.outcome,
                        })}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary">
                        {p.settledAt
                          ? p.settledAt.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Calibration buckets</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-bg-secondary text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2">N</th>
                <th className="px-3 py-2">Actual rate</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {buckets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-text-secondary">
                    No buckets yet.
                  </td>
                </tr>
              ) : (
                buckets.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{b.market}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {(b.probBucketLow * 100).toFixed(0)}–{(b.probBucketHigh * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 font-mono">{b.totalPredictions}</td>
                    <td className="px-3 py-2 font-mono">{(b.actualRate * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{b.calibrationError.toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ThresholdTable({
  title,
  rows,
  suffix,
}: {
  title: string;
  rows: Array<{
    label: string;
    threshold: number;
    picks: number;
    roi: number;
    hitRate: number;
    profitLoss: number;
  }>;
  suffix: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[360px] text-left text-sm">
        <thead className="bg-bg-secondary text-xs text-text-secondary">
          <tr>
            <th className="px-3 py-2">{title}</th>
            <th className="px-3 py-2">Picks</th>
            <th className="px-3 py-2">ROI</th>
            <th className="px-3 py-2">Hit rate</th>
            <th className="px-3 py-2">P/L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">
                {row.threshold.toFixed(0)}
                {suffix}
              </td>
              <td className="px-3 py-2 font-mono">{row.picks}</td>
              <td className="px-3 py-2 font-mono">{row.roi.toFixed(2)}%</td>
              <td className="px-3 py-2 font-mono">{(row.hitRate * 100).toFixed(1)}%</td>
              <td
                className={`px-3 py-2 font-mono ${
                  row.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {row.profitLoss >= 0 ? "+" : ""}
                {row.profitLoss.toFixed(2)}u
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BandTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    picks: number;
    roi: number;
    hitRate: number;
    avgEdgePct: number;
    avgExpectedValuePct: number;
    avgConfidencePct: number;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-bg-secondary text-xs text-text-secondary">
          <tr>
            <th className="px-3 py-2">{title}</th>
            <th className="px-3 py-2">Picks</th>
            <th className="px-3 py-2">ROI</th>
            <th className="px-3 py-2">Hit rate</th>
            <th className="px-3 py-2">Avg edge</th>
            <th className="px-3 py-2">Avg EV</th>
            <th className="px-3 py-2">Avg conf</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{row.label}</td>
              <td className="px-3 py-2 font-mono">{row.picks}</td>
              <td className="px-3 py-2 font-mono">{row.roi.toFixed(2)}%</td>
              <td className="px-3 py-2 font-mono">{(row.hitRate * 100).toFixed(1)}%</td>
              <td className="px-3 py-2 font-mono">{row.avgEdgePct.toFixed(1)}%</td>
              <td className="px-3 py-2 font-mono">{row.avgExpectedValuePct.toFixed(1)}%</td>
              <td className="px-3 py-2 font-mono">{row.avgConfidencePct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
