"use client";

import { useEffect, useState } from "react";

type TeamOpt = { id: number; name: string; shortName: string | null };

export default function AdminFlagsPage() {
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [flagTypes, setFlagTypes] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [fixtureId, setFixtureId] = useState<string>("");
  const [flagType, setFlagType] = useState<string>("manager_sacked");
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    fetch("/api/admin/flags")
      .then((r) => r.json())
      .then((d) => {
        setTeams(d.teams ?? []);
        setFlagTypes(d.flagTypes ?? []);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Saving…");
    const res = await fetch("/api/admin/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: teamId ? parseInt(teamId, 10) : null,
        fixtureId: fixtureId ? parseInt(fixtureId, 10) : null,
        flagType,
        description: description || undefined,
      }),
    });
    if (!res.ok) {
      setStatus(await res.text());
      return;
    }
    setStatus("Saved.");
    setDescription("");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Context flags</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manual multipliers applied in the v2 engine (clamped per team).
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border bg-bg-secondary p-4">
        <label className="block text-sm">
          <span className="text-text-secondary">Team (optional)</span>
          <select
            className="mt-1 w-full rounded border border-border bg-bg-card px-2 py-2 text-text-primary"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">— whole match / none —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName ?? t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-text-secondary">Fixture ID (optional)</span>
          <input
            className="mt-1 w-full rounded border border-border bg-bg-card px-2 py-2 font-mono text-text-primary"
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            placeholder="538104"
          />
        </label>

        <label className="block text-sm">
          <span className="text-text-secondary">Flag type</span>
          <select
            className="mt-1 w-full rounded border border-border bg-bg-card px-2 py-2 text-text-primary"
            value={flagType}
            onChange={(e) => setFlagType(e.target.value)}
          >
            {flagTypes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-text-secondary">Note</span>
          <textarea
            className="mt-1 w-full rounded border border-border bg-bg-card px-2 py-2 text-text-primary"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Create flag
        </button>
        {status && <p className="text-sm text-text-secondary">{status}</p>}
      </form>
    </div>
  );
}
