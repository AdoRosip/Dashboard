import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  console.log("Seeding demo data...");

  const competitions = [
    { id: "PL", code: "PL", name: "Premier League", country: "England", isEuropean: false },
    { id: "PD", code: "PD", name: "La Liga", country: "Spain", isEuropean: false },
    { id: "BL1", code: "BL1", name: "Bundesliga", country: "Germany", isEuropean: false },
    { id: "SA", code: "SA", name: "Serie A", country: "Italy", isEuropean: false },
    { id: "FL1", code: "FL1", name: "Ligue 1", country: "France", isEuropean: false },
    { id: "CL", code: "CL", name: "UEFA Champions League", country: "Europe", isEuropean: true },
    { id: "EC", code: "EC", name: "UEFA Europa League", country: "Europe", isEuropean: true },
    { id: "CLI", code: "CLI", name: "UEFA Conference League", country: "Europe", isEuropean: true },
  ];

  for (const c of competitions) {
    await prisma.competition.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const teams = [
    { id: 57, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", competitionId: "PL", crest: "https://crests.football-data.org/57.png", venueName: "Emirates Stadium", venueCapacity: 60704 },
    { id: 65, name: "Manchester City FC", shortName: "Man City", tla: "MCI", competitionId: "PL", crest: "https://crests.football-data.org/65.png", venueName: "Etihad Stadium", venueCapacity: 53400 },
    { id: 64, name: "Liverpool FC", shortName: "Liverpool", tla: "LIV", competitionId: "PL", crest: "https://crests.football-data.org/64.png", venueName: "Anfield", venueCapacity: 54074 },
    { id: 61, name: "Chelsea FC", shortName: "Chelsea", tla: "CHE", competitionId: "PL", crest: "https://crests.football-data.org/61.png", venueName: "Stamford Bridge", venueCapacity: 40834 },
    { id: 66, name: "Manchester United FC", shortName: "Man United", tla: "MUN", competitionId: "PL", crest: "https://crests.football-data.org/66.png", venueName: "Old Trafford", venueCapacity: 74310 },
    { id: 73, name: "Tottenham Hotspur FC", shortName: "Tottenham", tla: "TOT", competitionId: "PL", crest: "https://crests.football-data.org/73.png", venueName: "Tottenham Hotspur Stadium", venueCapacity: 62850 },
    { id: 86, name: "Real Madrid CF", shortName: "Real Madrid", tla: "RMA", competitionId: "PD", crest: "https://crests.football-data.org/86.png", venueName: "Santiago Bernabéu", venueCapacity: 81044 },
    { id: 81, name: "FC Barcelona", shortName: "Barcelona", tla: "FCB", competitionId: "PD", crest: "https://crests.football-data.org/81.png", venueName: "Spotify Camp Nou", venueCapacity: 99354 },
    { id: 5, name: "FC Bayern München", shortName: "Bayern", tla: "FCB", competitionId: "BL1", crest: "https://crests.football-data.org/5.png", venueName: "Allianz Arena", venueCapacity: 75024 },
    { id: 4, name: "Borussia Dortmund", shortName: "Dortmund", tla: "BVB", competitionId: "BL1", crest: "https://crests.football-data.org/4.png", venueName: "Signal Iduna Park", venueCapacity: 81365 },
    { id: 109, name: "Juventus FC", shortName: "Juventus", tla: "JUV", competitionId: "SA", crest: "https://crests.football-data.org/109.png", venueName: "Allianz Stadium", venueCapacity: 41507 },
    { id: 113, name: "SSC Napoli", shortName: "Napoli", tla: "NAP", competitionId: "SA", crest: "https://crests.football-data.org/113.png", venueName: "Stadio Diego Armando Maradona", venueCapacity: 54726 },
    { id: 524, name: "Paris Saint-Germain FC", shortName: "PSG", tla: "PSG", competitionId: "FL1", crest: "https://crests.football-data.org/524.png", venueName: "Parc des Princes", venueCapacity: 47929 },
    { id: 516, name: "Olympique de Marseille", shortName: "Marseille", tla: "OM", competitionId: "FL1", crest: "https://crests.football-data.org/516.png", venueName: "Stade Vélodrome", venueCapacity: 67394 },
  ];

  for (const t of teams) {
    await prisma.team.upsert({ where: { id: t.id }, update: t, create: t });
  }

  const statsData = [
    { teamId: 57, competitionId: "PL", position: 1, matchesPlayed: 30, wins: 22, draws: 5, losses: 3, points: 71, goalsScored: 65, goalsConceded: 22, goalsHome: 38, goalsAway: 27, concededHome: 8, concededAway: 14, xgFor: 60.5, xgAgainst: 25.3, xgHome: 34.2, xgAway: 26.3, cleanSheets: 14, bttsCount: 16, over25Count: 20, form: "WWWDW", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 65, competitionId: "PL", position: 2, matchesPlayed: 30, wins: 20, draws: 6, losses: 4, points: 66, goalsScored: 68, goalsConceded: 28, goalsHome: 40, goalsAway: 28, concededHome: 10, concededAway: 18, xgFor: 62.1, xgAgainst: 30.5, xgHome: 36.0, xgAway: 26.1, cleanSheets: 11, bttsCount: 19, over25Count: 22, form: "WWLWW", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 64, competitionId: "PL", position: 3, matchesPlayed: 30, wins: 19, draws: 7, losses: 4, points: 64, goalsScored: 62, goalsConceded: 25, goalsHome: 35, goalsAway: 27, concededHome: 9, concededAway: 16, xgFor: 58.4, xgAgainst: 27.9, xgHome: 32.0, xgAway: 26.4, cleanSheets: 13, bttsCount: 17, over25Count: 19, form: "WDWWL", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 61, competitionId: "PL", position: 4, matchesPlayed: 30, wins: 16, draws: 8, losses: 6, points: 56, goalsScored: 55, goalsConceded: 32, goalsHome: 30, goalsAway: 25, concededHome: 12, concededAway: 20, xgFor: 50.2, xgAgainst: 35.8, xgHome: 28.5, xgAway: 21.7, cleanSheets: 9, bttsCount: 20, over25Count: 18, form: "WDLDW", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 66, competitionId: "PL", position: 7, matchesPlayed: 30, wins: 12, draws: 8, losses: 10, points: 44, goalsScored: 42, goalsConceded: 40, goalsHome: 25, goalsAway: 17, concededHome: 15, concededAway: 25, xgFor: 45.1, xgAgainst: 38.7, xgHome: 26.0, xgAway: 19.1, cleanSheets: 7, bttsCount: 22, over25Count: 17, form: "LDWDL", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 73, competitionId: "PL", position: 5, matchesPlayed: 30, wins: 15, draws: 6, losses: 9, points: 51, goalsScored: 58, goalsConceded: 38, goalsHome: 33, goalsAway: 25, concededHome: 14, concededAway: 24, xgFor: 52.8, xgAgainst: 40.1, xgHome: 30.3, xgAway: 22.5, cleanSheets: 8, bttsCount: 21, over25Count: 21, form: "WWLWD", matchesPlayedHome: 15, matchesPlayedAway: 15 },
    { teamId: 86, competitionId: "PD", position: 1, matchesPlayed: 28, wins: 21, draws: 4, losses: 3, points: 67, goalsScored: 60, goalsConceded: 20, goalsHome: 35, goalsAway: 25, concededHome: 7, concededAway: 13, xgFor: 55.2, xgAgainst: 23.1, xgHome: 31.0, xgAway: 24.2, cleanSheets: 15, bttsCount: 13, over25Count: 17, form: "WWWWW", matchesPlayedHome: 14, matchesPlayedAway: 14 },
    { teamId: 81, competitionId: "PD", position: 2, matchesPlayed: 28, wins: 20, draws: 5, losses: 3, points: 65, goalsScored: 72, goalsConceded: 25, goalsHome: 42, goalsAway: 30, concededHome: 8, concededAway: 17, xgFor: 65.8, xgAgainst: 28.4, xgHome: 38.5, xgAway: 27.3, cleanSheets: 12, bttsCount: 16, over25Count: 22, form: "WWDWW", matchesPlayedHome: 14, matchesPlayedAway: 14 },
  ];

  for (const s of statsData) {
    await prisma.teamSeasonStats.upsert({
      where: { teamId_competitionId_season: { teamId: s.teamId, competitionId: s.competitionId, season: "2025" } },
      update: s,
      create: { ...s, season: "2025" },
    });
  }

  // Fixtures
  const now = new Date();
  const upcomingFixtures = [
    { id: 900001, competitionId: "PL", homeTeamId: 57, awayTeamId: 65, daysFromNow: 2, matchday: 31 },
    { id: 900002, competitionId: "PL", homeTeamId: 64, awayTeamId: 61, daysFromNow: 2, matchday: 31 },
    { id: 900003, competitionId: "PL", homeTeamId: 73, awayTeamId: 66, daysFromNow: 3, matchday: 31 },
    { id: 900004, competitionId: "PD", homeTeamId: 86, awayTeamId: 81, daysFromNow: 4, matchday: 29 },
    { id: 900005, competitionId: "BL1", homeTeamId: 5, awayTeamId: 4, daysFromNow: 5, matchday: 27 },
    { id: 900006, competitionId: "SA", homeTeamId: 109, awayTeamId: 113, daysFromNow: 5, matchday: 30 },
    { id: 900007, competitionId: "FL1", homeTeamId: 524, awayTeamId: 516, daysFromNow: 6, matchday: 28 },
    { id: 900008, competitionId: "PL", homeTeamId: 65, awayTeamId: 64, daysFromNow: 7, matchday: 32 },
    { id: 900009, competitionId: "PL", homeTeamId: 61, awayTeamId: 57, daysFromNow: 8, matchday: 32 },
    { id: 900010, competitionId: "CL", homeTeamId: 57, awayTeamId: 81, daysFromNow: 10, matchday: 1 },
  ];

  for (const f of upcomingFixtures) {
    const utcDate = new Date(now.getTime() + f.daysFromNow * 24 * 60 * 60 * 1000);
    utcDate.setHours(20, 0, 0, 0);
    await prisma.fixture.upsert({
      where: { id: f.id },
      update: {},
      create: { id: f.id, competitionId: f.competitionId, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, utcDate, status: "SCHEDULED", matchday: f.matchday },
    });
  }

  // Finished fixtures
  const finished = [
    { id: 800001, competitionId: "PL", homeTeamId: 57, awayTeamId: 73, daysAgo: 3, sh: 3, sa: 1, w: "HOME" },
    { id: 800002, competitionId: "PL", homeTeamId: 66, awayTeamId: 57, daysAgo: 7, sh: 0, sa: 2, w: "AWAY" },
    { id: 800003, competitionId: "PL", homeTeamId: 57, awayTeamId: 64, daysAgo: 14, sh: 1, sa: 1, w: "DRAW" },
    { id: 800004, competitionId: "PL", homeTeamId: 61, awayTeamId: 57, daysAgo: 21, sh: 0, sa: 1, w: "AWAY" },
    { id: 800005, competitionId: "PL", homeTeamId: 57, awayTeamId: 66, daysAgo: 28, sh: 3, sa: 0, w: "HOME" },
    { id: 800006, competitionId: "PL", homeTeamId: 65, awayTeamId: 73, daysAgo: 3, sh: 4, sa: 1, w: "HOME" },
    { id: 800007, competitionId: "PL", homeTeamId: 65, awayTeamId: 61, daysAgo: 7, sh: 2, sa: 0, w: "HOME" },
    { id: 800008, competitionId: "PL", homeTeamId: 64, awayTeamId: 65, daysAgo: 14, sh: 1, sa: 3, w: "AWAY" },
    { id: 800009, competitionId: "PL", homeTeamId: 65, awayTeamId: 66, daysAgo: 21, sh: 2, sa: 1, w: "HOME" },
    { id: 800010, competitionId: "PL", homeTeamId: 73, awayTeamId: 65, daysAgo: 28, sh: 1, sa: 2, w: "AWAY" },
    { id: 800011, competitionId: "PL", homeTeamId: 65, awayTeamId: 57, daysAgo: 120, sh: 1, sa: 0, w: "HOME" },
    { id: 800012, competitionId: "PL", homeTeamId: 57, awayTeamId: 65, daysAgo: 250, sh: 1, sa: 0, w: "HOME" },
    { id: 800013, competitionId: "PL", homeTeamId: 65, awayTeamId: 57, daysAgo: 400, sh: 4, sa: 1, w: "HOME" },
    { id: 800014, competitionId: "PL", homeTeamId: 57, awayTeamId: 65, daysAgo: 490, sh: 1, sa: 3, w: "AWAY" },
    { id: 800015, competitionId: "CL", homeTeamId: 57, awayTeamId: 65, daysAgo: 600, sh: 0, sa: 0, w: "DRAW" },
  ];

  for (const f of finished) {
    const utcDate = new Date(now.getTime() - f.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.fixture.upsert({
      where: { id: f.id },
      update: {},
      create: { id: f.id, competitionId: f.competitionId, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, utcDate, status: "FINISHED", scoreHomeFt: f.sh, scoreAwayFt: f.sa, winner: f.w },
    });
  }

  // H2H records
  for (const f of finished) {
    const [teamAId, teamBId] = f.homeTeamId < f.awayTeamId ? [f.homeTeamId, f.awayTeamId] : [f.awayTeamId, f.homeTeamId];
    const scoreA = f.homeTeamId === teamAId ? f.sh : f.sa;
    const scoreB = f.homeTeamId === teamAId ? f.sa : f.sh;
    const utcDate = new Date(now.getTime() - f.daysAgo * 24 * 60 * 60 * 1000);
    if ((teamAId === 57 && teamBId === 65) || (teamAId === 64 && teamBId === 65) || (teamAId === 57 && teamBId === 64)) {
      try {
        await prisma.h2HMatch.upsert({
          where: { teamAId_teamBId_date: { teamAId, teamBId, date: utcDate } },
          update: {},
          create: { teamAId, teamBId, fixtureId: f.id, date: utcDate, scoreA, scoreB, competitionId: f.competitionId, homeTeamId: f.homeTeamId },
        });
      } catch { /* skip */ }
    }
  }

  // Players
  const players = [
    { id: 100001, teamId: 57, name: "Bukayo Saka", position: "Right Winger", isKeyPlayer: true },
    { id: 100002, teamId: 57, name: "Martin Ødegaard", position: "Attacking Midfield", isKeyPlayer: true },
    { id: 100003, teamId: 57, name: "Kai Havertz", position: "Centre-Forward", isKeyPlayer: true },
    { id: 100004, teamId: 57, name: "Gabriel Jesus", position: "Centre-Forward", isKeyPlayer: false },
    { id: 100005, teamId: 65, name: "Erling Haaland", position: "Centre-Forward", isKeyPlayer: true },
    { id: 100006, teamId: 65, name: "Phil Foden", position: "Attacking Midfield", isKeyPlayer: true },
    { id: 100007, teamId: 65, name: "Kevin De Bruyne", position: "Central Midfield", isKeyPlayer: true },
    { id: 100008, teamId: 64, name: "Mohamed Salah", position: "Right Winger", isKeyPlayer: true },
    { id: 100009, teamId: 64, name: "Darwin Núñez", position: "Centre-Forward", isKeyPlayer: true },
    { id: 100010, teamId: 81, name: "Robert Lewandowski", position: "Centre-Forward", isKeyPlayer: true },
    { id: 100011, teamId: 86, name: "Vinícius Júnior", position: "Left Winger", isKeyPlayer: true },
    { id: 100012, teamId: 86, name: "Jude Bellingham", position: "Attacking Midfield", isKeyPlayer: true },
  ];

  for (const p of players) {
    await prisma.player.upsert({ where: { id: p.id }, update: p, create: p });
  }

  // Player season aggregates
  const playerAggs = [
    { playerId: 100001, goals: 16, assists: 12, xg: 14.2, xa: 9.8, minutes: 2450, goalsPer90: 0.59, xgPer90: 0.52, xaPer90: 0.36, isPenaltyTaker: false },
    { playerId: 100002, goals: 8, assists: 10, xg: 7.5, xa: 11.2, minutes: 2100, goalsPer90: 0.34, xgPer90: 0.32, xaPer90: 0.48, isPenaltyTaker: false },
    { playerId: 100003, goals: 12, assists: 5, xg: 10.8, xa: 4.2, minutes: 2350, goalsPer90: 0.46, xgPer90: 0.41, xaPer90: 0.16, isPenaltyTaker: false },
    { playerId: 100004, goals: 5, assists: 3, xg: 7.2, xa: 2.8, minutes: 1200, goalsPer90: 0.38, xgPer90: 0.54, xaPer90: 0.21, isPenaltyTaker: false },
    { playerId: 100005, goals: 25, assists: 4, xg: 22.5, xa: 3.1, minutes: 2500, goalsPer90: 0.90, xgPer90: 0.81, xaPer90: 0.11, isPenaltyTaker: true },
    { playerId: 100006, goals: 14, assists: 8, xg: 11.3, xa: 7.5, minutes: 2300, goalsPer90: 0.55, xgPer90: 0.44, xaPer90: 0.29, isPenaltyTaker: false },
    { playerId: 100007, goals: 6, assists: 15, xg: 5.8, xa: 13.2, minutes: 1800, goalsPer90: 0.30, xgPer90: 0.29, xaPer90: 0.66, isPenaltyTaker: false },
    { playerId: 100008, goals: 18, assists: 11, xg: 15.6, xa: 8.9, minutes: 2480, goalsPer90: 0.65, xgPer90: 0.57, xaPer90: 0.32, isPenaltyTaker: true },
    { playerId: 100009, goals: 10, assists: 4, xg: 12.8, xa: 3.5, minutes: 1900, goalsPer90: 0.47, xgPer90: 0.61, xaPer90: 0.17, isPenaltyTaker: false },
    { playerId: 100010, goals: 20, assists: 6, xg: 17.5, xa: 5.2, minutes: 2400, goalsPer90: 0.75, xgPer90: 0.66, xaPer90: 0.20, isPenaltyTaker: true },
    { playerId: 100011, goals: 15, assists: 9, xg: 13.8, xa: 7.1, minutes: 2380, goalsPer90: 0.57, xgPer90: 0.52, xaPer90: 0.27, isPenaltyTaker: false },
    { playerId: 100012, goals: 12, assists: 7, xg: 10.2, xa: 6.8, minutes: 2300, goalsPer90: 0.47, xgPer90: 0.40, xaPer90: 0.27, isPenaltyTaker: false },
  ];

  for (const pa of playerAggs) {
    await prisma.playerSeasonAgg.upsert({
      where: { playerId_competitionId_season: { playerId: pa.playerId, competitionId: players.find(p => p.id === pa.playerId)!.teamId === 57 || players.find(p => p.id === pa.playerId)!.teamId === 65 || players.find(p => p.id === pa.playerId)!.teamId === 64 || players.find(p => p.id === pa.playerId)!.teamId === 61 || players.find(p => p.id === pa.playerId)!.teamId === 66 || players.find(p => p.id === pa.playerId)!.teamId === 73 ? "PL" : players.find(p => p.id === pa.playerId)!.teamId === 86 || players.find(p => p.id === pa.playerId)!.teamId === 81 ? "PD" : "PL", season: "2025" } },
      update: { ...pa, matches: 30, starts: 25 },
      create: { ...pa, competitionId: players.find(p => p.id === pa.playerId)!.teamId === 86 || players.find(p => p.id === pa.playerId)!.teamId === 81 ? "PD" : "PL", season: "2025", matches: 30, starts: 25 },
    });
  }

  // Injuries
  await prisma.injury.deleteMany({});
  await prisma.injury.createMany({
    data: [
      { playerId: 100004, teamId: 57, type: "Knee Ligament", bodyPart: "knee", severity: "Moderate", status: "out", expectedReturn: "Apr 28" },
      { playerId: 100007, teamId: 65, type: "Hamstring", bodyPart: "hamstring", severity: "Minor", status: "doubt", expectedReturn: "Apr 15" },
    ],
  });

  // Coaches
  await prisma.coach.deleteMany({});
  await prisma.coach.createMany({
    data: [
      { name: "Mikel Arteta", teamId: 57, formationPrimary: "4-3-3", tacticalStyle: "possession" },
      { name: "Pep Guardiola", teamId: 65, formationPrimary: "4-3-3", tacticalStyle: "possession" },
      { name: "Arne Slot", teamId: 64, formationPrimary: "4-3-3", tacticalStyle: "pressing" },
      { name: "Carlo Ancelotti", teamId: 86, formationPrimary: "4-3-3", tacticalStyle: "mixed" },
      { name: "Hansi Flick", teamId: 81, formationPrimary: "4-3-3", tacticalStyle: "pressing" },
    ],
  });

  await prisma.dataRefreshLog.create({
    data: { source: "seed", status: "success", message: "Demo data seeded v2", count: upcomingFixtures.length },
  });

  console.log("Seed complete!");
}

seed()
  .then(() => prisma.$disconnect())
  .catch((err) => { console.error(err); prisma.$disconnect(); process.exit(1); });
