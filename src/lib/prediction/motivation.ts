import { prisma } from "../db";
import { CURRENT_SEASON } from "../constants";
import { isDerbyOrRivalry } from "../data/rivalries";

export interface MotivationContext {
  leaguePosition?: number | null;
  points?: number | null;
  matchday?: number | null;
  matchesPlayed?: number | null;
  competitionId: string;
  isKnockout: boolean;
  homeTeamId: number;
  awayTeamId: number;
  teamId: number;
  fixtureDate: Date;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Heuristic motivation score and lambda modifier for a team in a fixture.
 */
export function computeMotivationScore(ctx: MotivationContext): {
  motivationScore: number;
  lambdaModifier: number;
  titleRace: boolean;
  top4Race: boolean;
  relegationBattle: boolean;
  nothingToPlayFor: boolean;
  isDerby: boolean;
  isRivalry: boolean;
} {
  const pos = ctx.leaguePosition ?? 10;
  const md = ctx.matchday ?? 20;
  const { isDerby, isRivalry } = isDerbyOrRivalry(ctx.homeTeamId, ctx.awayTeamId);

  let base = 0.5;
  if (ctx.isKnockout) base = 0.95;
  else if (pos <= 4 && md >= 34) base = 0.9;
  else if (pos >= 16 && md >= 28) base = 0.88;
  else if (pos >= 4 && pos <= 7 && md >= 25) base = 0.75;
  else if (ctx.competitionId === "CL" || ctx.competitionId === "EC") base = 0.7;
  else if (pos >= 8 && pos <= 14 && md > 34) base = 0.25;

  let motivationScore = base;
  if (isDerby || isRivalry) motivationScore += 0.1;
  if (ctx.teamId === ctx.homeTeamId) motivationScore += 0.03;

  const titleRace = pos <= 3 && md >= 30;
  const top4Race = pos >= 4 && pos <= 7 && md >= 25;
  const relegationBattle = pos >= 16 && md >= 28;
  const nothingToPlayFor = pos >= 8 && pos <= 14 && md > 34;

  motivationScore = clamp01(motivationScore);

  const lambdaModifier = 0.92 + motivationScore * 0.16;

  return {
    motivationScore,
    lambdaModifier,
    titleRace,
    top4Race,
    relegationBattle,
    nothingToPlayFor,
    isDerby,
    isRivalry,
  };
}

export async function upsertMatchImportanceRow(
  fixtureId: number,
  teamId: number,
  homeTeamId: number,
  awayTeamId: number,
  competitionId: string,
  statsCompetitionId: string,
  matchday: number | null,
  isKnockout: boolean,
) {
  const stats = await prisma.teamSeasonStats.findFirst({
    where: { teamId, competitionId: statsCompetitionId, season: CURRENT_SEASON },
  });

  const m = computeMotivationScore({
    leaguePosition: stats?.position,
    points: stats?.points,
    matchday,
    matchesPlayed: stats?.matchesPlayed,
    competitionId,
    isKnockout,
    homeTeamId,
    awayTeamId,
    teamId,
    fixtureDate: new Date(),
  });

  await prisma.matchImportance.upsert({
    where: { teamId_fixtureId: { teamId, fixtureId } },
    create: {
      teamId,
      fixtureId,
      leaguePosition: stats?.position,
      matchdayNumber: matchday,
      remainingMatches: null,
      competitionStage: isKnockout ? "knockout" : "league",
      isKnockout,
      isDerby: m.isDerby,
      isRivalry: m.isRivalry,
      titleRace: m.titleRace,
      top4Race: m.top4Race,
      relegationBattle: m.relegationBattle,
      nothingToPlayFor: m.nothingToPlayFor,
      motivationScore: m.motivationScore,
      lambdaModifier: m.lambdaModifier,
    },
    update: {
      leaguePosition: stats?.position,
      matchdayNumber: matchday,
      competitionStage: isKnockout ? "knockout" : "league",
      isKnockout,
      isDerby: m.isDerby,
      isRivalry: m.isRivalry,
      titleRace: m.titleRace,
      top4Race: m.top4Race,
      relegationBattle: m.relegationBattle,
      nothingToPlayFor: m.nothingToPlayFor,
      motivationScore: m.motivationScore,
      lambdaModifier: m.lambdaModifier,
    },
  });
}
