import Link from "next/link";
import { prisma } from "@/lib/db";
import { meanHeadlineBrier } from "@/lib/calibration";
import {
  formatPickProfitLossDisplay,
  formatPickStakeDisplay,
  pickProfitLossNumericForUi,
} from "@/lib/odds/stake-units";

export const dynamic = "force-dynamic";

export default async function ModelPerformancePage() {
  const [buckets, perf, audits, settledPicks] = await Promise.all([
    prisma.calibrationBucket.findMany({ orderBy: [{ market: "asc" }], take: 120 }),
    prisma.bettingPerformance.findMany({ take: 20 }),
    prisma.predictionAudit.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
    prisma.valuePick.findMany({
      where: { settled: true, outcome: { in: ["win", "loss"] } },
      orderBy: { settledAt: "desc" },
      take: 150,
      include: {
        fixture: {
          include: { homeTeam: true, awayTeam: true, competition: true },
        },
      },
    }),
  ]);

  const brierHeadline = meanHeadlineBrier(audits);
  const brierAll =
    audits.length > 0
      ? audits.reduce((s, a) => s + a.brierContribution, 0) / audits.length
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Model performance</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Calibration buckets and betting results. Run{" "}
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
                          quarterKelly: p.quarterKelly,
                          rating: p.rating,
                          modelProb: p.modelProb,
                          bestOdds: p.bestOdds,
                        })}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono ${
                          pickProfitLossNumericForUi({
                            stakeUnits: p.stakeUnits,
                            profitLoss: p.profitLoss,
                            quarterKelly: p.quarterKelly,
                            rating: p.rating,
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
                          quarterKelly: p.quarterKelly,
                          rating: p.rating,
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
