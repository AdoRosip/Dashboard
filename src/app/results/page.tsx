import Link from "next/link";
import { buildMvpResultsReport } from "@/lib/mvp/results";
import { SurfaceBadge } from "@/components/surface-badge";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const report = await buildMvpResultsReport();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3">
            <SurfaceBadge tone="production" label="Production Record" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">Results</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Product-facing performance for the MVP production scope only: top 5 domestic leagues
            and supported <code className="rounded bg-bg-card px-1">1x2</code> markets.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/value-picks" className="text-accent hover:underline">
            Value picks
          </Link>
          <Link href="/api/results" className="text-accent hover:underline">
            Results JSON
          </Link>
          <Link href="/model-performance" className="text-accent hover:underline">
            Research view
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <h2 className="text-sm font-medium text-text-primary">Overall</h2>
        <p className="mt-1 text-xs text-text-secondary">
          Based on settled immutable bet decisions inside the MVP production scope.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-text-secondary">Picks</dt>
            <dd className="font-mono text-text-primary">{report.overall.picks}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Win rate</dt>
            <dd className="font-mono text-text-primary">
              {(report.overall.hitRate * 100).toFixed(1)}%
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">ROI</dt>
            <dd className="font-mono text-text-primary">{report.overall.roi.toFixed(2)}%</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Profit/Loss</dt>
            <dd
              className={`font-mono ${
                report.overall.profitLoss >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {report.overall.profitLoss >= 0 ? "+" : ""}
              {report.overall.profitLoss.toFixed(2)}u
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Avg odds</dt>
            <dd className="font-mono text-text-primary">{report.overall.avgOdds.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Avg CLV</dt>
            <dd className="text-xs text-text-secondary">
              {report.overall.closingLineSampleSize} real closes only
            </dd>
            <dd className="font-mono text-text-primary">
              {report.overall.avgClosingLineValue == null
                ? "—"
                : `${(report.overall.avgClosingLineValue * 100).toFixed(2)}%`}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ResultsTable
          title="By market"
          rows={report.byMarket.map((row) => ({
            label: row.market,
            picks: row.picks,
            roi: row.roi,
            hitRate: row.hitRate,
            profitLoss: row.profitLoss,
          }))}
        />
        <ResultsTable
          title="By league"
          rows={report.byLeague.map((row) => ({
            label: row.competition,
            picks: row.picks,
            roi: row.roi,
            hitRate: row.hitRate,
            profitLoss: row.profitLoss,
          }))}
        />
        <ResultsTable
          title="By month"
          rows={report.byMonth.map((row) => ({
            label: row.month,
            picks: row.picks,
            roi: row.roi,
            hitRate: row.hitRate,
            profitLoss: row.profitLoss,
          }))}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text-primary">Recent settled picks</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-bg-secondary text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Odds</th>
                <th className="px-3 py-2">P/L</th>
                <th className="px-3 py-2">Settled</th>
              </tr>
            </thead>
            <tbody>
              {report.recentSettled.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-text-secondary">
                    No settled production picks yet.
                  </td>
                </tr>
              ) : (
                report.recentSettled.map((row) => (
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
                          row.outcome === "win"
                            ? "rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400"
                            : row.outcome === "loss"
                              ? "rounded bg-red-500/15 px-2 py-0.5 text-red-400"
                              : "rounded bg-bg-card px-2 py-0.5 text-text-secondary"
                        }
                      >
                        {row.outcome ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.score}</td>
                    <td className="px-3 py-2 font-mono">{(row.modelProb * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{row.bestOdds.toFixed(2)}</td>
                    <td
                      className={`px-3 py-2 font-mono ${
                        (row.profitLoss ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {row.profitLoss == null
                        ? "—"
                        : `${row.profitLoss >= 0 ? "+" : ""}${row.profitLoss.toFixed(2)}u`}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {row.settledAt
                        ? new Date(row.settledAt).toLocaleDateString()
                        : "—"}
                    </td>
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

function ResultsTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    picks: number;
    roi: number;
    hitRate: number;
    profitLoss: number;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[360px] text-left text-sm">
        <thead className="bg-bg-secondary text-xs text-text-secondary">
          <tr>
            <th className="px-3 py-2">{title}</th>
            <th className="px-3 py-2">Picks</th>
            <th className="px-3 py-2">ROI</th>
            <th className="px-3 py-2">Win rate</th>
            <th className="px-3 py-2">P/L</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-text-secondary">
                No rows yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="px-3 py-2">{row.label}</td>
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
