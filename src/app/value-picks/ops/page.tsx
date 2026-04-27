import Link from "next/link";
import { prisma } from "@/lib/db";
import { getBetDecisionHistory } from "@/lib/odds/bet-decisions";
import { FIXTURE_STATUS_LIVE } from "@/lib/odds/fixture-pick-status";
import { getUpcomingValueDiagnostics } from "@/lib/odds/value-diagnostics";
import { getMvpProductHealth } from "@/lib/mvp/health";
import { attachValuePickRationale } from "@/lib/mvp/pick-rationale";
import {
  MVP_PRODUCTION_VALUE_MARKETS,
  MVP_SUPPORTED_COMPETITION_CODES,
} from "@/lib/mvp/config";
import {
  DecisionTable,
  NearMissesTable,
  PicksTable,
  type DecisionRow,
  type ValuePickRow,
} from "../shared";
import { SurfaceBadge } from "@/components/surface-badge";

export const dynamic = "force-dynamic";

const pickInclude = {
  fixture: {
    include: { homeTeam: true, awayTeam: true, competition: true },
  },
} as const;

function parseRunMessage(raw: string | null): {
  preparedAt?: string;
  blockers?: string[];
  warnings?: string[];
  policyVersion?: string;
  routingVersion?: string;
} | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      preparedAt?: string;
      blockers?: string[];
      warnings?: string[];
      policyVersion?: string;
      routingVersion?: string;
    };
  } catch {
    return null;
  }
}

export default async function ValuePicksOpsPage() {
  const now = new Date();
  const [health, pendingPicksRaw, diagnostics, decisions, latestRun] = await Promise.all([
    getMvpProductHealth(),
    prisma.valuePick.findMany({
      where: {
        market: { in: [...MVP_PRODUCTION_VALUE_MARKETS] },
        settled: false,
        fixture: { competitionId: { in: [...MVP_SUPPORTED_COMPETITION_CODES] } },
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
    getUpcomingValueDiagnostics(),
    getBetDecisionHistory(40, {
      markets: [...MVP_PRODUCTION_VALUE_MARKETS],
      competitionIds: [...MVP_SUPPORTED_COMPETITION_CODES],
    }),
    prisma.dataRefreshLog.findFirst({
      where: { source: "mvp_prepare" },
      orderBy: { timestamp: "desc" },
    }),
  ]);

  const pendingWithRationale = await attachValuePickRationale(pendingPicksRaw);
  const pendingPicks = pendingWithRationale as unknown as ValuePickRow[];
  const latestRunMessage = parseRunMessage(latestRun?.message ?? null);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3">
            <SurfaceBadge tone="ops" label="Internal Ops Surface" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">Value picks ops</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Operational and diagnostic view for the MVP picks pipeline. Use this to investigate
            warnings, blockers, and settlement state. It is not the trusted decision surface.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/value-picks" className="text-accent hover:underline">
            Back to picks
          </Link>
          <Link href="/results" className="text-accent hover:underline">
            Results
          </Link>
          <Link href="/api/value-picks/diagnostics" className="text-accent hover:underline">
            Diagnostics JSON
          </Link>
          <Link href="/api/value-picks/decisions" className="text-accent hover:underline">
            Decisions JSON
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <h2 className="text-sm font-medium text-text-primary">Ops status</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <dt className="text-text-secondary">Health</dt>
            <dd className="font-mono text-text-primary">{health.status}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Publish</dt>
            <dd className="font-mono text-text-primary">{health.canPublish ? "enabled" : "blocked"}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Policy</dt>
            <dd className="font-mono text-text-primary">{diagnostics.policyVersion}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Routing</dt>
            <dd className="font-mono text-text-primary">{diagnostics.routingVersion}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Candidates</dt>
            <dd className="font-mono text-text-primary">{diagnostics.summary.totalCandidates}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Qualified</dt>
            <dd className="font-mono text-emerald-400">
              {diagnostics.summary.qualifyingCandidates}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Trusted run workflow</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Use <code className="rounded bg-bg-card px-1">npm run mvp:prepare</code> as the single
              daily command for your trusted production path.
            </p>
          </div>
          <span className="rounded bg-bg-card px-2 py-1 text-xs text-text-secondary">
            latest status: {latestRun?.status ?? "none"}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-text-secondary">Last run</dt>
            <dd className="font-mono text-text-primary">
              {latestRun?.timestamp ? new Date(latestRun.timestamp).toLocaleString() : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Pick count</dt>
            <dd className="font-mono text-text-primary">{latestRun?.count ?? 0}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Policy</dt>
            <dd className="font-mono text-text-primary">
              {latestRunMessage?.policyVersion ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Routing</dt>
            <dd className="font-mono text-text-primary">
              {latestRunMessage?.routingVersion ?? "—"}
            </dd>
          </div>
        </dl>
        {latestRunMessage?.blockers && latestRunMessage.blockers.length > 0 && (
          <div className="mt-4 space-y-1 text-xs text-red-300">
            {latestRunMessage.blockers.map((blocker) => (
              <p key={blocker}>{blocker}</p>
            ))}
          </div>
        )}
        {latestRunMessage?.warnings && latestRunMessage.warnings.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-amber-200">
            {latestRunMessage.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
      </section>

      <PicksTable
        title="Pending settlement"
        subtitle="Kickoff has passed, but these picks are still unsettled in the database."
        picks={pendingPicks}
        emptyMessage="No pending settlement rows."
        showScore
        tone="amber"
      />

      <NearMissesTable diagnostics={diagnostics.nearMisses} />
      <DecisionTable rows={decisions.recent as DecisionRow[]} />
    </div>
  );
}
