import Link from "next/link";
import { formatPickStakeDisplay } from "@/lib/odds/stake-units";
import type { ProductionPickRationale } from "@/lib/mvp/pick-rationale";

export type ValuePickRow = {
  id: number;
  fixtureId: number;
  market: string;
  modelProb: number;
  impliedProb: number;
  bestOdds: number;
  bestBookmaker: string;
  edgePct: number;
  quarterKelly: number;
  rating: number;
  ratingLabel: string;
  stakeUnits: number | null;
  rationale: ProductionPickRationale;
  fixture: {
    status: string;
    scoreHomeFt: number | null;
    scoreAwayFt: number | null;
    competition: { name: string };
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
  };
};

export type DecisionRow = {
  id: number;
  fixtureId: number;
  market: string;
  source: string;
  decidedAt: Date;
  settled: boolean;
  outcome: string | null;
  profitLoss: number | null;
  edgePct: number;
  expectedValuePct: number;
  confidencePct: number;
  bestOdds: number;
  bestBookmaker: string;
  competitionId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
};

export type NearMissRow = {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  utcDate: string;
  market: string;
  bestOdds: number;
  bestBookmaker: string;
  modelProb: number;
  impliedProb: number;
  edgePct: number;
  expectedValue: number;
  reasonLabels: string[];
};

export function PicksTable({
  title,
  subtitle,
  picks,
  emptyMessage,
  showScore,
  tone,
}: {
  title: string;
  subtitle: string;
  picks: ValuePickRow[];
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
              <th className="px-3 py-2">Quality</th>
              <th className="px-3 py-2">Stake</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">Why it qualifies</th>
            </tr>
          </thead>
          <tbody>
            {picks.length === 0 ? (
              <tr>
                <td
                  colSpan={showScore ? 12 : 11}
                  className="px-3 py-6 text-center text-text-secondary"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              picks.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link href={`/match/${p.fixtureId}`} className="text-accent hover:underline">
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
                        ? `${p.fixture.scoreHomeFt}-${p.fixture.scoreAwayFt}`
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
                    {(p.rationale.dataQualityScore * 100).toFixed(0)}%
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
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded bg-bg-card px-2 py-0.5">
                          {p.rationale.modelSource}
                        </span>
                        <span className="rounded bg-bg-card px-2 py-0.5">
                          {p.rationale.bookmakerCount} books
                        </span>
                        <span className="rounded bg-bg-card px-2 py-0.5">
                          {p.rationale.oddsAgeHours == null
                            ? "freshness unknown"
                            : `${p.rationale.oddsAgeHours.toFixed(1)}h old`}
                        </span>
                      </div>
                      {p.rationale.summary.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      {p.rationale.topDrivers.map((line) => (
                        <p key={line} className="text-text-primary">
                          {line}
                        </p>
                      ))}
                    </div>
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

export function DecisionTable({ rows }: { rows: DecisionRow[] }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-text-primary">Recent decisions</h2>
      <p className="mt-1 text-xs text-text-secondary">
        Accepted candidates recorded as immutable bet decisions. Current qualifiers can change;
        these rows do not.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
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
              <th className="px-3 py-2">Book</th>
              <th className="px-3 py-2">P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-text-secondary">
                  No bet decisions recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link href={`/match/${row.fixtureId}`} className="text-accent hover:underline">
                      {row.homeTeam} vs {row.awayTeam}
                    </Link>
                    <div className="text-xs text-text-secondary">{row.competition}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.market}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded bg-bg-card px-2 py-0.5">{row.source}</span>
                  </td>
                  <td className="px-3 py-2 font-mono">{row.edgePct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{row.expectedValuePct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{row.confidencePct.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{row.bestOdds.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">{row.bestBookmaker}</td>
                  <td
                    className={`px-3 py-2 font-mono ${
                      (row.profitLoss ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {row.profitLoss == null
                      ? row.settled
                        ? "0.00u"
                        : "—"
                      : `${row.profitLoss >= 0 ? "+" : ""}${row.profitLoss.toFixed(2)}u`}
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

export function NearMissesTable({ diagnostics }: { diagnostics: NearMissRow[] }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-text-primary">Near misses</h2>
      <p className="mt-1 text-xs text-text-secondary">
        Highest-edge rejected markets in the next 48h. This is the fastest way to see why no pick
        was flagged.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-bg-secondary text-xs text-text-secondary">
            <tr>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Implied</th>
              <th className="px-3 py-2">Odds</th>
              <th className="px-3 py-2">Book</th>
              <th className="px-3 py-2">Edge</th>
              <th className="px-3 py-2">EV</th>
              <th className="px-3 py-2">Failed on</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-text-secondary">
                  No rejected candidates in the current window.
                </td>
              </tr>
            ) : (
              diagnostics.map((market) => (
                <tr key={`${market.fixtureId}-${market.market}`} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link href={`/match/${market.fixtureId}`} className="text-accent hover:underline">
                      {market.homeTeam} vs {market.awayTeam}
                    </Link>
                    <div className="text-xs text-text-secondary">
                      {market.competition} · {new Date(market.utcDate).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{market.market}</td>
                  <td className="px-3 py-2 font-mono">{(market.modelProb * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{(market.impliedProb * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{market.bestOdds.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">{market.bestBookmaker}</td>
                  <td className="px-3 py-2 font-mono">{market.edgePct.toFixed(1)}%</td>
                  <td
                    className={`px-3 py-2 font-mono ${
                      market.expectedValue >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {(market.expectedValue * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {market.reasonLabels.join(", ")}
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
