import type { TeamSeasonStats, Fixture, Player, PlayerSeasonAgg, H2HMatch } from "@prisma/client";

type PlayerWithStats = Player & { seasonAgg: PlayerSeasonAgg[]; injuries: { type: string }[] };

interface MatchContext {
  homeStats: TeamSeasonStats | null;
  awayStats: TeamSeasonStats | null;
  homeForm: Fixture[];
  awayForm: Fixture[];
  h2h: H2HMatch[];
  homePlayers: PlayerWithStats[];
  awayPlayers: PlayerWithStats[];
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
}

export function generateInsights(ctx: MatchContext): string[] {
  const insights: string[] = [];
  const { homeStats, awayStats, homeForm, awayForm, h2h } = ctx;

  if (homeStats && homeStats.matchesPlayedHome > 0) {
    const homeWins = ctx.homeForm
      .filter((f) => f.homeTeamId === ctx.homeTeamId && f.winner === "HOME")
      .length;
    const homeGames = ctx.homeForm.filter(
      (f) => f.homeTeamId === ctx.homeTeamId,
    ).length;
    if (homeGames > 0) {
      const winPct = Math.round((homeWins / homeGames) * 100);
      if (winPct >= 60)
        insights.push(
          `${ctx.homeTeamName} wins ${winPct}% of home games this season`,
        );
    }

    const goalsPerHomeGame =
      homeStats.goalsHome / homeStats.matchesPlayedHome;
    if (goalsPerHomeGame >= 2.0)
      insights.push(
        `${ctx.homeTeamName} averages ${goalsPerHomeGame.toFixed(1)} goals/game at home`,
      );

    if (homeStats.matchesPlayed > 0) {
      const csPct = Math.round(
        (homeStats.cleanSheets / homeStats.matchesPlayed) * 100,
      );
      if (csPct >= 40)
        insights.push(
          `${ctx.homeTeamName} keeps a clean sheet in ${csPct}% of matches`,
        );
    }
  }

  if (awayStats && awayStats.matchesPlayedAway > 0) {
    const concededPerAway =
      awayStats.concededAway / awayStats.matchesPlayedAway;
    if (concededPerAway >= 1.5)
      insights.push(
        `${ctx.awayTeamName} concedes ${concededPerAway.toFixed(1)} goals/game away`,
      );

    const awayGoalsPerGame =
      awayStats.goalsAway / awayStats.matchesPlayedAway;
    if (awayGoalsPerGame < 1.0)
      insights.push(
        `${ctx.awayTeamName} struggles away — only ${awayGoalsPerGame.toFixed(1)} goals/game`,
      );
  }

  // BTTS insight
  if (homeStats && homeStats.matchesPlayed > 0) {
    const bttsPct = Math.round(
      (homeStats.bttsCount / homeStats.matchesPlayed) * 100,
    );
    if (bttsPct >= 60)
      insights.push(
        `Both teams score in ${bttsPct}% of ${ctx.homeTeamName}'s matches`,
      );
  }

  // Over 2.5 insight
  if (homeStats && homeStats.matchesPlayed > 0) {
    const overPct = Math.round(
      (homeStats.over25Count / homeStats.matchesPlayed) * 100,
    );
    if (overPct >= 60)
      insights.push(
        `Over 2.5 goals in ${overPct}% of ${ctx.homeTeamName}'s matches`,
      );
  }

  // xG insights
  if (homeStats && homeStats.xgFor > 0 && homeStats.matchesPlayed > 0) {
    const xgPerGame = homeStats.xgFor / homeStats.matchesPlayed;
    const actualPerGame = homeStats.goalsScored / homeStats.matchesPlayed;
    const diff = actualPerGame - xgPerGame;
    if (diff > 0.3)
      insights.push(
        `${ctx.homeTeamName} is overperforming xG by ${diff.toFixed(2)} goals/game`,
      );
    else if (diff < -0.3)
      insights.push(
        `${ctx.homeTeamName} is underperforming xG by ${Math.abs(diff).toFixed(2)} goals/game`,
      );
  }

  if (awayStats && awayStats.xgFor > 0 && awayStats.matchesPlayed > 0) {
    const xgPerGame = awayStats.xgFor / awayStats.matchesPlayed;
    const actualPerGame = awayStats.goalsScored / awayStats.matchesPlayed;
    const diff = actualPerGame - xgPerGame;
    if (diff > 0.3)
      insights.push(
        `${ctx.awayTeamName} is overperforming xG by ${diff.toFixed(2)} goals/game`,
      );
    else if (diff < -0.3)
      insights.push(
        `${ctx.awayTeamName} is underperforming xG by ${Math.abs(diff).toFixed(2)} goals/game`,
      );
  }

  // H2H insights
  if (h2h.length >= 3) {
    const totalGoals = h2h.reduce((s, m) => s + m.scoreA + m.scoreB, 0);
    const avgGoals = totalGoals / h2h.length;
    if (avgGoals > 2.5)
      insights.push(
        `H2H: Average ${avgGoals.toFixed(1)} goals in last ${h2h.length} meetings`,
      );

    const over25 = h2h.filter((m) => m.scoreA + m.scoreB > 2).length;
    if (over25 / h2h.length >= 0.6)
      insights.push(
        `H2H: Over 2.5 goals in ${over25} of last ${h2h.length} meetings`,
      );
  }

  // Form insights
  if (homeForm.length >= 3) {
    const recentWins = homeForm.slice(0, 5).filter((f) => {
      if (f.homeTeamId === ctx.homeTeamId) return f.winner === "HOME";
      return f.winner === "AWAY";
    }).length;
    if (recentWins >= 4)
      insights.push(
        `${ctx.homeTeamName} won ${recentWins} of their last 5 matches`,
      );
  }

  if (awayForm.length >= 3) {
    const recentLosses = awayForm.slice(0, 5).filter((f) => {
      if (f.homeTeamId === ctx.awayTeamId) return f.winner === "AWAY";
      return f.winner === "HOME";
    }).length;
    if (recentLosses >= 3)
      insights.push(
        `${ctx.awayTeamName} lost ${recentLosses} of their last 5 matches`,
      );
  }

  // Injured key player insight
  const injuredKey = [
    ...ctx.homePlayers.filter((p) => p.isKeyPlayer && p.injuries.length > 0),
    ...ctx.awayPlayers.filter((p) => p.isKeyPlayer && p.injuries.length > 0),
  ];

  for (const player of injuredKey) {
    const stats = player.seasonAgg[0];
    if (stats) {
      const teamName =
        player.teamId === ctx.homeTeamId
          ? ctx.homeTeamName
          : ctx.awayTeamName;
      insights.push(
        `Key player ${player.name} (${stats.goals}G, ${stats.assists}A) is injured for ${teamName}`,
      );
    }
  }

  return insights.slice(0, 8);
}
