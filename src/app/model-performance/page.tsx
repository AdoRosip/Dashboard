import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ModelPerformancePage() {
  const [buckets, perf, audits] = await Promise.all([
    prisma.calibrationBucket.findMany({ orderBy: [{ market: "asc" }], take: 120 }),
    prisma.bettingPerformance.findMany({ take: 20 }),
    prisma.predictionAudit.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);

  const brier =
    audits.length > 0
      ? audits.reduce((s, a) => s + a.brierContribution, 0) / audits.length
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Model performance</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Calibration buckets and aggregate error metrics. Run{" "}
          <code className="rounded bg-bg-card px-1">POST /api/calibration/run</code> to
          populate from finished fixtures.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <h2 className="text-sm font-medium text-text-primary">Summary</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-secondary">Mean Brier (sample)</dt>
            <dd className="font-mono text-text-primary">
              {brier != null ? brier.toFixed(4) : "—"}
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
                <th className="px-3 py-2">Avg CLV</th>
                <th className="px-3 py-2">Picks</th>
              </tr>
            </thead>
            <tbody>
              {perf.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-text-secondary">
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
