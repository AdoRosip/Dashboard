"use client";

import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Calendar, Filter } from "lucide-react";
import clsx from "clsx";

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

interface PredictionBadge {
  probHomeWin: number;
  probDraw: number;
  probAwayWin: number;
  modelConfidence: number;
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
  predictions?: PredictionBadge[];
}

export function FixturesList({ fixtures, competitions }: { fixtures: Fixture[]; competitions: Competition[] }) {
  const [selectedLeague, setSelectedLeague] = useState<string>("all");

  const filtered = useMemo(() => {
    if (selectedLeague === "all") return fixtures;
    return fixtures.filter((f) => f.competitionId === selectedLeague);
  }, [fixtures, selectedLeague]);

  const grouped = useMemo(() => {
    const map: Record<string, Record<string, Fixture[]>> = {};
    for (const f of filtered) {
      const dateKey = f.utcDate.split("T")[0];
      if (!map[dateKey]) map[dateKey] = {};
      if (!map[dateKey][f.competitionId]) map[dateKey][f.competitionId] = [];
      map[dateKey][f.competitionId].push(f);
    }
    return map;
  }, [filtered]);

  const dates = Object.keys(grouped).sort();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-text-muted" />
        <button
          onClick={() => setSelectedLeague("all")}
          className={clsx("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", selectedLeague === "all" ? "bg-accent text-white" : "bg-bg-card text-text-secondary hover:bg-bg-card-hover")}
        >
          All Leagues
        </button>
        {competitions.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedLeague(c.id)}
            className={clsx("rounded-full px-3 py-1.5 text-xs font-medium transition-colors", selectedLeague === c.id ? "bg-accent text-white" : "bg-bg-card text-text-secondary hover:bg-bg-card-hover")}
          >
            {c.name}
          </button>
        ))}
      </div>

      {dates.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-bg-card py-16">
          <Calendar className="mb-3 h-10 w-10 text-text-muted" />
          <p className="text-text-secondary">No upcoming fixtures found</p>
          <p className="mt-1 text-sm text-text-muted">Try refreshing the data or check back later</p>
        </div>
      )}

      {dates.map((dateKey) => (
        <div key={dateKey} className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              {format(parseISO(dateKey), "EEEE, MMMM d, yyyy")}
            </h2>
          </div>

          {Object.entries(grouped[dateKey]).map(([compId, matches]) => (
            <div key={compId} className="mb-4">
              <div className="mb-2 flex items-center gap-2 pl-1">
                {matches[0]?.competition.emblem && <img src={matches[0].competition.emblem} alt="" className="h-4 w-4" />}
                <span className="text-xs font-medium text-text-muted">{matches[0]?.competition.name}</span>
              </div>

              <div className="space-y-1">
                {matches.map((f) => {
                  const pred = f.predictions?.[0];
                  return (
                    <a
                      key={f.id}
                      href={`/match/${f.id}`}
                      className="group flex items-center rounded-lg border border-border bg-bg-card p-3 transition-all hover:border-accent/40 hover:bg-bg-card-hover"
                    >
                      <TeamBadge team={f.homeTeam} align="right" />

                      <div className="mx-4 flex flex-col items-center">
                        {pred ? (
                          <MiniPrediction pred={pred} />
                        ) : (
                          <span className="text-xs text-text-muted">
                            {format(parseISO(f.utcDate), "HH:mm")}
                          </span>
                        )}
                      </div>

                      <TeamBadge team={f.awayTeam} align="left" />

                      <div className="ml-auto hidden text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                        View Analysis →
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TeamBadge({ team, align }: { team: Team; align: "left" | "right" }) {
  return (
    <div className={clsx("flex min-w-[140px] items-center gap-2", align === "right" ? "flex-row-reverse" : "flex-row")}>
      {team.crest ? (
        <img src={team.crest} alt={team.name} className="h-6 w-6 object-contain" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-[10px] font-bold text-text-muted">
          {team.tla ?? team.name.slice(0, 3).toUpperCase()}
        </div>
      )}
      <span className={clsx("text-sm font-medium text-text-primary", align === "right" ? "text-right" : "text-left")}>
        {team.shortName ?? team.name}
      </span>
    </div>
  );
}

function MiniPrediction({ pred }: { pred: PredictionBadge }) {
  const h = Math.round(pred.probHomeWin * 100);
  const d = Math.round(pred.probDraw * 100);
  const a = Math.round(pred.probAwayWin * 100);

  const conf = pred.modelConfidence;
  const confColor = conf > 0.7 ? "border-win/30" : conf > 0.4 ? "border-draw/30" : "border-border";

  return (
    <div className={clsx("flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1", confColor)}>
      <div className="flex gap-1.5 text-[10px] font-bold">
        <span className="text-accent">{h}%</span>
        <span className="text-draw">{d}%</span>
        <span className="text-loss">{a}%</span>
      </div>
      <div className="flex h-1.5 w-16 overflow-hidden rounded-full">
        <div className="bg-accent" style={{ width: `${h}%` }} />
        <div className="bg-draw/70" style={{ width: `${d}%` }} />
        <div className="bg-loss/70" style={{ width: `${a}%` }} />
      </div>
    </div>
  );
}
