"use client";

import { format, parseISO } from "date-fns";
import { ArrowLeft, AlertTriangle, Zap, TrendingUp, Users, Swords, Lightbulb, Target, BarChart3, Shield } from "lucide-react";
import clsx from "clsx";
import { StatsComparison } from "./stats-comparison";
import { FormStrip } from "./form-strip";
import { H2HSection } from "./h2h-section";
import { PlayerSection } from "./player-section";
import { CollapsibleSection } from "./collapsible-section";
import { PredictionSummary } from "./prediction-summary";
import { ScorelineHeatmap } from "./scoreline-heatmap";
import { MarketProbabilities } from "./market-probabilities";

interface Team {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

interface Competition {
  id: string;
  name: string;
  code: string;
  emblem: string | null;
}

interface TeamStats {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  position: number | null;
  goalsScored: number;
  goalsConceded: number;
  goalsHome: number;
  goalsAway: number;
  concededHome: number;
  concededAway: number;
  xgFor: number;
  xgAgainst: number;
  xgHome: number;
  xgAway: number;
  cleanSheets: number;
  bttsCount: number;
  over25Count: number;
  form: string;
  matchesPlayedHome: number;
  matchesPlayedAway: number;
}

interface FixtureResult {
  id: number;
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  utcDate: string;
  status: string;
  scoreHomeFt: number | null;
  scoreAwayFt: number | null;
  winner: string | null;
  homeTeam: Team;
  awayTeam: Team;
  competition: Competition;
}

interface H2HMatch {
  id: number;
  teamAId: number;
  teamBId: number;
  date: string;
  scoreA: number;
  scoreB: number;
  competition: Competition | null;
}

interface PlayerStats {
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  minutes: number;
  xgPer90: number;
  xaPer90: number;
}

interface InjuryData {
  type: string;
  bodyPart: string | null;
  severity: string | null;
  expectedReturn: string | null;
  status: string;
}

interface PlayerData {
  id: number;
  name: string;
  position: string | null;
  isKeyPlayer: boolean;
  teamId: number;
  seasonAgg: PlayerStats[];
  injuries: InjuryData[];
}

interface Fixture {
  id: number;
  competitionId: string;
  homeTeamId: number;
  awayTeamId: number;
  utcDate: string;
  status: string;
  matchday: number | null;
  venue: string | null;
  homeTeam: Team;
  awayTeam: Team;
  competition: Competition;
}

export interface PredictionData {
  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;
  lambdaHome: number;
  lambdaAway: number;
  expectedTotalGoals: number;
  probOver05: number;
  probOver15: number;
  probOver25: number;
  probOver35: number;
  probOver45: number;
  probBttsYes: number;
  probBttsNo: number;
  probHomeCs: number;
  probAwayCs: number;
  scorelineProbabilities: Record<string, number>;
  htFtProbabilities: Record<string, number>;
  topScorelines: Array<{ home: number; away: number; prob: number }>;
  modelConfidence: number;
  featureBreakdown: {
    homeAttack: number;
    homeDefense: number;
    awayAttack: number;
    awayDefense: number;
    homeForm: number;
    awayForm: number;
    homeInjuryImpact: number;
    awayInjuryImpact: number;
    homeAdvantage: number;
    tacticalStyle: string;
  };
  insights: string[];
}

interface MatchData {
  fixture: Fixture;
  homeStats: TeamStats | null;
  awayStats: TeamStats | null;
  homeForm: FixtureResult[];
  awayForm: FixtureResult[];
  h2h: H2HMatch[];
  homePlayers: PlayerData[];
  awayPlayers: PlayerData[];
  prediction: PredictionData | null;
}

export function MatchDashboard({ data }: { data: MatchData }) {
  const { fixture, homeStats, awayStats, homeForm, awayForm, h2h, homePlayers, awayPlayers, prediction } = data;
  const home = fixture.homeTeam;
  const away = fixture.awayTeam;

  return (
    <div className="space-y-6 pb-12">
      <a href="/" className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-accent">
        <ArrowLeft className="h-4 w-4" /> Back to fixtures
      </a>

      {/* ===== HEADER ===== */}
      <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-bg-card to-bg-secondary">
        <div className="flex flex-col items-center px-4 py-8 sm:flex-row sm:justify-center sm:gap-8 sm:py-10">
          <TeamLogo team={home} side="home" />
          <div className="my-4 flex flex-col items-center sm:my-0">
            <div className="flex items-center gap-2">
              {fixture.competition.emblem && <img src={fixture.competition.emblem} alt="" className="h-5 w-5" />}
              <span className="text-xs font-medium text-text-muted">
                {fixture.competition.name}{fixture.matchday && ` · Matchday ${fixture.matchday}`}
              </span>
            </div>
            {prediction ? (
              <PredictionSummary prediction={prediction} homeName={home.tla ?? home.shortName ?? home.name} awayName={away.tla ?? away.shortName ?? away.name} />
            ) : (
              <div className="my-2 text-2xl font-bold text-text-primary">VS</div>
            )}
            <div className="text-sm text-text-secondary">
              {format(parseISO(fixture.utcDate), "EEEE, MMMM d · HH:mm")}
            </div>
            {fixture.venue && <div className="mt-1 text-xs text-text-muted">{fixture.venue}</div>}
          </div>
          <TeamLogo team={away} side="away" />
        </div>

        {(homeStats?.position || awayStats?.position) && (
          <div className="flex justify-center gap-8 border-t border-border bg-bg-secondary/50 px-4 py-2 text-xs text-text-muted">
            {homeStats?.position && <span>{home.tla ?? home.shortName}: #{homeStats.position} · {homeStats.points}pts · {homeStats.form || "—"}</span>}
            {awayStats?.position && <span>{away.tla ?? away.shortName}: #{awayStats.position} · {awayStats.points}pts · {awayStats.form || "—"}</span>}
          </div>
        )}
      </div>

      {/* ===== PREDICTION INSIGHTS ===== */}
      {prediction && prediction.insights.length > 0 && (
        <CollapsibleSection title="Prediction Insights" icon={<Lightbulb className="h-4 w-4" />} defaultOpen>
          <div className="grid gap-2 sm:grid-cols-2">
            {prediction.insights.map((insight, i) => (
              <div key={i} className={clsx(
                "flex items-start gap-2 rounded-lg px-3 py-2",
                i === 0 ? "bg-accent/10 border border-accent/20 sm:col-span-2" : "bg-bg-secondary/60",
              )}>
                <Zap className={clsx("mt-0.5 h-3.5 w-3.5 shrink-0", i === 0 ? "text-accent" : "text-text-muted")} />
                <span className={clsx("text-sm", i === 0 ? "text-text-primary font-medium" : "text-text-secondary")}>{insight}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ===== SCORELINE HEATMAP ===== */}
      {prediction && (
        <CollapsibleSection title="Scoreline Probabilities" icon={<Target className="h-4 w-4" />} defaultOpen>
          <ScorelineHeatmap
            scorelines={prediction.scorelineProbabilities}
            topScorelines={prediction.topScorelines}
            homeName={home.tla ?? home.shortName ?? home.name}
            awayName={away.tla ?? away.shortName ?? away.name}
          />
        </CollapsibleSection>
      )}

      {/* ===== MARKET PROBABILITIES ===== */}
      {prediction && (
        <CollapsibleSection title="Market Probabilities" icon={<BarChart3 className="h-4 w-4" />} defaultOpen>
          <MarketProbabilities prediction={prediction} />
        </CollapsibleSection>
      )}

      {/* ===== TEAM STATS COMPARISON ===== */}
      <CollapsibleSection title="Team Stats Comparison" icon={<TrendingUp className="h-4 w-4" />} defaultOpen>
        <StatsComparison homeStats={homeStats} awayStats={awayStats} homeName={home.shortName ?? home.name} awayName={away.shortName ?? away.name} />
      </CollapsibleSection>

      {/* ===== FORM ===== */}
      <CollapsibleSection title="Recent Form" icon={<TrendingUp className="h-4 w-4" />} defaultOpen>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-medium text-text-secondary">{home.shortName ?? home.name}</h4>
            <FormStrip matches={homeForm} teamId={fixture.homeTeamId} />
          </div>
          <div>
            <h4 className="mb-3 text-sm font-medium text-text-secondary">{away.shortName ?? away.name}</h4>
            <FormStrip matches={awayForm} teamId={fixture.awayTeamId} />
          </div>
        </div>
      </CollapsibleSection>

      {/* ===== H2H ===== */}
      <CollapsibleSection title="Head to Head" icon={<Swords className="h-4 w-4" />} defaultOpen={h2h.length > 0}>
        <H2HSection h2h={h2h} homeTeam={home} awayTeam={away} />
      </CollapsibleSection>

      {/* ===== KEY PLAYERS ===== */}
      <CollapsibleSection title="Key Players & Top Scorers" icon={<Users className="h-4 w-4" />} defaultOpen>
        <div className="grid gap-6 md:grid-cols-2">
          <PlayerSection teamName={home.shortName ?? home.name} players={homePlayers} />
          <PlayerSection teamName={away.shortName ?? away.name} players={awayPlayers} />
        </div>
      </CollapsibleSection>

      {/* ===== INJURIES ===== */}
      {(homePlayers.some((p) => p.injuries.length > 0) || awayPlayers.some((p) => p.injuries.length > 0)) && (
        <CollapsibleSection title="Injuries & Suspensions" icon={<AlertTriangle className="h-4 w-4" />} defaultOpen>
          <div className="grid gap-6 md:grid-cols-2">
            <InjuryList teamName={home.shortName ?? home.name} players={homePlayers.filter((p) => p.injuries.length > 0)} />
            <InjuryList teamName={away.shortName ?? away.name} players={awayPlayers.filter((p) => p.injuries.length > 0)} />
          </div>
        </CollapsibleSection>
      )}

      {/* ===== MODEL INFO ===== */}
      {prediction && (
        <CollapsibleSection title="Model Information" icon={<Shield className="h-4 w-4" />} defaultOpen={false}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-text-muted">Model:</span>
              <span className="font-mono text-text-secondary">Dixon-Coles Adjusted Poisson v1.0</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-text-muted">Confidence:</span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 overflow-hidden rounded-full bg-bg-primary">
                  <div className={clsx("h-full rounded-full", prediction.modelConfidence > 0.7 ? "bg-win" : prediction.modelConfidence > 0.4 ? "bg-draw" : "bg-loss")} style={{ width: `${prediction.modelConfidence * 100}%` }} />
                </div>
                <span className="text-text-secondary">{(prediction.modelConfidence * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-text-muted">Expected Goals:</span>
              <span className="text-text-secondary">λ<sub>home</sub> = {prediction.lambdaHome.toFixed(2)}, λ<sub>away</sub> = {prediction.lambdaAway.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-text-muted">Tactical Profile:</span>
              <span className="rounded bg-bg-secondary px-2 py-0.5 text-xs text-text-secondary">{prediction.featureBreakdown.tacticalStyle.replace(/_/g, " ")}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FeaturePill label="Home Attack" value={prediction.featureBreakdown.homeAttack} suffix=" xG/g" />
              <FeaturePill label="Home Defense" value={prediction.featureBreakdown.homeDefense} suffix=" xGA/g" />
              <FeaturePill label="Away Attack" value={prediction.featureBreakdown.awayAttack} suffix=" xG/g" />
              <FeaturePill label="Away Defense" value={prediction.featureBreakdown.awayDefense} suffix=" xGA/g" />
            </div>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function TeamLogo({ team, side }: { team: Team; side: "home" | "away" }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {team.crest ? (
        <img src={team.crest} alt={team.name} className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-secondary text-xl font-bold text-text-muted sm:h-20 sm:w-20">
          {team.tla ?? team.name.slice(0, 3).toUpperCase()}
        </div>
      )}
      <div className="text-center">
        <div className="text-base font-semibold text-text-primary sm:text-lg">{team.shortName ?? team.name}</div>
        <div className={clsx("text-xs", side === "home" ? "text-accent" : "text-text-muted")}>
          {side === "home" ? "Home" : "Away"}
        </div>
      </div>
    </div>
  );
}

function InjuryList({ teamName, players }: { teamName: string; players: PlayerData[] }) {
  if (players.length === 0) return <div className="text-sm text-text-muted">No injuries reported for {teamName}</div>;
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-text-secondary">{teamName}</h4>
      <div className="space-y-1.5">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-lg bg-bg-secondary/60 px-3 py-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{p.name}</span>
                {p.isKeyPlayer && <span className="rounded bg-loss/20 px-1.5 py-0.5 text-[10px] font-bold text-loss">KEY</span>}
              </div>
              <div className="text-xs text-text-muted">{p.position ?? "Unknown position"}</div>
            </div>
            <div className="text-right">
              {p.injuries.map((inj, i) => (
                <div key={i} className="text-xs text-injury">
                  {inj.type}{inj.bodyPart && ` (${inj.bodyPart})`}
                  <span className="ml-1 rounded px-1 py-0.5 text-[10px]" style={{ background: inj.status === "out" ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)", color: inj.status === "out" ? "#ef4444" : "#eab308" }}>
                    {inj.status.toUpperCase()}
                  </span>
                  {inj.expectedReturn && <span className="ml-1 text-text-muted">· {inj.expectedReturn}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturePill({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-lg bg-bg-secondary/60 px-3 py-2 text-center">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text-primary">{value.toFixed(2)}{suffix}</div>
    </div>
  );
}
