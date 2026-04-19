import Link from "next/link";
import { prisma } from "@/lib/db";
import { FIXTURE_STATUS_LIVE } from "@/lib/odds/fixture-pick-status";
import { formatPickStakeDisplay } from "@/lib/odds/stake-units";

export const dynamic = "force-dynamic";

const pickInclude = {
  fixture: {
    include: { homeTeam: true, awayTeam: true, competition: true },
  },
} as const;

export default async function ValuePicksPage() {
  const now = new Date();
  const [activePicks, pendingPicks, perf, settledWithClvCount] = await Promise.all([
    prisma.valuePick.findMany({
      where: {
        settled: false,
        OR: [
          { fixture: { status: { in: [...FIXTURE_STATUS_LIVE] } } },
          { fixture: { utcDate: { gt: now } } },
        ],
      },
      orderBy: [{ edge: "desc" }],
      include: pickInclude,
      take: 100,
    }),
    prisma.valuePick.findMany({
      where: {
        settled: false,
        NOT: {
          OR: [
            { fixture: { status: { in: [...FIXTURE_STATUS_LIVE] } } },
            { fixture: { utcDate: { gt: now } } },
          ],
        },
      },
      orderBy: [{ fixture: { utcDate: "desc" } }],
      include: pickInclude,
      take: 200,
    }),
    prisma.bettingPerformance.findFirst({
      where: { period: "all_time", market: "all", league: "all" },
    }),
    prisma.valuePick.count({
      where: { settled: true, closingLineValue: { not: null } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Value picks</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Model vs bookmaker implied probabilities. Requires{" "}
          <code className="rounded bg-bg-card px-1">ODDS_API_KEY</code> and ingestion (
          <code className="rounded bg-bg-card px-1">npm run ingest</code>
          ). <strong>Active</strong> means kickoff is still in the future, or the match is live
          — we use <code className="rounded bg-bg-card px-1">utcDate</code>, not only API status
          (status can stay SCHEDULED until ingest updates). Past kickoff unsettled picks go to{" "}
          <strong>Pending settlement</strong> until{" "}
          <code className="rounded bg-bg-card px-1">npm run betting:settle</code> (also runs after a
          full ingest).{" "}
          <strong>Stake</strong> is in <strong>units</strong> (1u = your standard bet size); sizing
          follows rating + expected value (see <code className="rounded bg-bg-card px-1">stake-units.ts</code>
          ). A <strong>*</strong> on stake means legacy quarter-Kelly was stored as 0 (stake still comes from the unit model).
        </p>
      </div>

      {perf && (
        <section className="rounded-xl border border-border bg-bg-secondary p-4">
          <h2 className="text-sm font-medium text-text-primary">All-time performance</h2>
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
                {settledWithClvCount === 0 ? (
                  <span title="Closing-line value: edge vs price at kickoff close. Needs a closing (or latest) odds snapshot when settling.">
                    —
                  </span>
                ) : (
                  `${(perf.avgClosingLineValue * 100).toFixed(2)}%`
                )}
              </dd>
              <dd className="mt-0.5 text-[11px] leading-snug text-text-secondary">
                {settledWithClvCount === 0
                  ? "No closing odds on settled picks yet (shows 0% until snapshots exist)."
                  : `Mean vs closing line, ${settledWithClvCount} pick${settledWithClvCount === 1 ? "" : "s"} with data.`}
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
        subtitle="Match not started or still in play (fixture status: scheduled, timed, or live)."
        picks={activePicks}
        emptyMessage="No active picks — ensure ODDS_API_KEY, ingest + odds refresh (e.g. npm run daily), fixtures in the next 48h, and model edge vs book (≥3%) per checkValue."
      />

      <PicksTable
        title="Pending settlement"
        subtitle="Kickoff has passed; pick still unsettled. Needs full-time scores in the DB (run npm run ingest), then npm run betting:settle. Rows leave this list once settled."
        picks={pendingPicks}
        emptyMessage="None — all finished picks are settled, or no picks in this state."
        showScore
        tone="amber"
      />
    </div>
  );
}

function PicksTable({
  title,
  subtitle,
  picks,
  emptyMessage,
  showScore,
  tone,
}: {
  title: string;
  subtitle: string;
  picks: Awaited<ReturnType<typeof prisma.valuePick.findMany<{ include: typeof pickInclude }>>>;
  emptyMessage: string;
  showScore?: boolean;
  tone?: "amber";
}) {
  return (
    <section>
      <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      <p
        className={`mt-1 text-xs ${tone === "amber" ? "text-amber-600/90 dark:text-amber-400/90" : "text-text-secondary"}`}
      >
        {subtitle}
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-bg-secondary text-xs text-text-secondary">
            <tr>
              <th className="px-3 py-2">Match</th>
              {showScore && <th className="px-3 py-2">FT</th>}
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Implied</th>
              <th className="px-3 py-2">Odds</th>
              <th className="px-3 py-2">Book</th>
              <th className="px-3 py-2">Edge</th>
              <th className="px-3 py-2">Stake</th>
              <th className="px-3 py-2">Rating</th>
            </tr>
          </thead>
          <tbody>
            {picks.length === 0 ? (
              <tr>
                <td
                  colSpan={showScore ? 10 : 9}
                  className="px-3 py-6 text-center text-text-secondary"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              picks.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      href={`/match/${p.fixtureId}`}
                      className="text-accent hover:underline"
                    >
                      {p.fixture.homeTeam.shortName ?? p.fixture.homeTeam.name} vs{" "}
                      {p.fixture.awayTeam.shortName ?? p.fixture.awayTeam.name}
                    </Link>
                    <div className="text-xs text-text-secondary">
                      {p.fixture.competition.name} · {p.fixture.status}
                    </div>
                  </td>
                  {showScore && (
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.fixture.scoreHomeFt != null && p.fixture.scoreAwayFt != null
                        ? `${p.fixture.scoreHomeFt}–${p.fixture.scoreAwayFt}`
                        : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs">{p.market}</td>
                  <td className="px-3 py-2 font-mono">{(p.modelProb * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{(p.impliedProb * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{p.bestOdds.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">{p.bestBookmaker}</td>
                  <td className="px-3 py-2 font-mono text-emerald-400">
                    +{p.edgePct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPickStakeDisplay({
                      stakeUnits: p.stakeUnits,
                      quarterKelly: p.quarterKelly,
                      rating: p.rating,
                      modelProb: p.modelProb,
                      bestOdds: p.bestOdds,
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-bg-card px-2 py-0.5 text-xs">
                      {p.rating}★ {p.ratingLabel}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
