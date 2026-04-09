/**
 * Maps Understat team names → football-data.org team names.
 *
 * football-data.org names are what we store in our DB. Understat uses
 * shorter/different naming conventions. This mapping handles the known
 * discrepancies. For unknown names we fall back to fuzzy substring matching.
 */

const UNDERSTAT_TO_CANONICAL: Record<string, string[]> = {
  // EPL
  Arsenal: ["Arsenal FC", "Arsenal"],
  "Aston Villa": ["Aston Villa FC", "Aston Villa"],
  Bournemouth: ["AFC Bournemouth", "Bournemouth"],
  Brentford: ["Brentford FC", "Brentford"],
  Brighton: ["Brighton & Hove Albion FC", "Brighton"],
  Chelsea: ["Chelsea FC", "Chelsea"],
  "Crystal Palace": ["Crystal Palace FC", "Crystal Palace"],
  Everton: ["Everton FC", "Everton"],
  Fulham: ["Fulham FC", "Fulham"],
  Ipswich: ["Ipswich Town FC", "Ipswich Town", "Ipswich"],
  Leicester: ["Leicester City FC", "Leicester City", "Leicester"],
  Liverpool: ["Liverpool FC", "Liverpool"],
  "Manchester City": ["Manchester City FC", "Manchester City"],
  "Manchester United": ["Manchester United FC", "Manchester United"],
  "Newcastle United": ["Newcastle United FC", "Newcastle United", "Newcastle"],
  "Nottingham Forest": ["Nottingham Forest FC", "Nottingham Forest"],
  Southampton: ["Southampton FC", "Southampton"],
  Tottenham: ["Tottenham Hotspur FC", "Tottenham Hotspur", "Tottenham"],
  "West Ham": ["West Ham United FC", "West Ham United", "West Ham"],
  "Wolverhampton Wanderers": [
    "Wolverhampton Wanderers FC",
    "Wolverhampton Wanderers",
    "Wolves",
  ],

  // La Liga
  Alaves: ["Deportivo Alavés", "Alavés", "Alaves"],
  "Athletic Club": ["Athletic Club", "Athletic Bilbao"],
  "Atletico Madrid": ["Club Atlético de Madrid", "Atlético Madrid", "Atletico Madrid", "Atlético de Madrid"],
  Barcelona: ["FC Barcelona", "Barcelona"],
  "Celta Vigo": ["RC Celta de Vigo", "Celta Vigo", "Celta de Vigo"],
  Espanyol: ["RCD Espanyol de Barcelona", "Espanyol", "RCD Espanyol"],
  Getafe: ["Getafe CF", "Getafe"],
  Girona: ["Girona FC", "Girona"],
  "Las Palmas": ["UD Las Palmas", "Las Palmas"],
  Leganes: ["CD Leganés", "Leganés", "Leganes"],
  Mallorca: ["RCD Mallorca", "Mallorca"],
  Osasuna: ["CA Osasuna", "Osasuna"],
  "Rayo Vallecano": ["Rayo Vallecano de Madrid", "Rayo Vallecano"],
  "Real Betis": ["Real Betis Balompié", "Real Betis"],
  "Real Madrid": ["Real Madrid CF", "Real Madrid"],
  "Real Sociedad": ["Real Sociedad de Fútbol", "Real Sociedad"],
  "Real Valladolid": ["Real Valladolid CF", "Real Valladolid", "Valladolid"],
  Sevilla: ["Sevilla FC", "Sevilla"],
  Valencia: ["Valencia CF", "Valencia"],
  Villarreal: ["Villarreal CF", "Villarreal"],

  // Bundesliga
  Augsburg: ["FC Augsburg", "Augsburg"],
  "Bayer Leverkusen": ["Bayer 04 Leverkusen", "Bayer Leverkusen"],
  "Bayern Munich": ["FC Bayern München", "Bayern Munich", "Bayern München"],
  Bochum: ["VfL Bochum 1848", "VfL Bochum", "Bochum"],
  "Borussia Dortmund": ["Borussia Dortmund", "BV Borussia 09 Dortmund", "Dortmund"],
  "Borussia M.Gladbach": [
    "Borussia Mönchengladbach",
    "Borussia M.Gladbach",
    "Mönchengladbach",
  ],
  "Eintracht Frankfurt": ["Eintracht Frankfurt", "Frankfurt"],
  "FC Heidenheim": ["1. FC Heidenheim 1846", "FC Heidenheim", "Heidenheim"],
  Freiburg: ["Sport-Club Freiburg", "SC Freiburg", "Freiburg"],
  Hoffenheim: ["TSG 1899 Hoffenheim", "Hoffenheim"],
  "Holstein Kiel": ["Holstein Kiel", "Kiel"],
  "Mainz 05": ["1. FSV Mainz 05", "Mainz 05", "Mainz"],
  "RasenBallsport Leipzig": [
    "RB Leipzig",
    "RasenBallsport Leipzig",
    "Leipzig",
  ],
  "St. Pauli": ["FC St. Pauli 1910", "FC St. Pauli", "St. Pauli"],
  "Union Berlin": ["1. FC Union Berlin", "Union Berlin"],
  "VfB Stuttgart": ["VfB Stuttgart", "Stuttgart"],
  "Werder Bremen": ["SV Werder Bremen", "Werder Bremen", "Bremen"],
  Wolfsburg: ["VfL Wolfsburg", "Wolfsburg"],

  // Serie A
  "AC Milan": ["AC Milan", "Milan"],
  Atalanta: ["Atalanta BC", "Atalanta"],
  Bologna: ["Bologna FC 1909", "Bologna FC", "Bologna"],
  Cagliari: ["Cagliari Calcio", "Cagliari"],
  Como: ["Como 1907", "Como"],
  Empoli: ["Empoli FC", "Empoli"],
  Fiorentina: ["ACF Fiorentina", "Fiorentina"],
  Genoa: ["Genoa CFC", "Genoa"],
  Inter: ["FC Internazionale Milano", "Inter Milan", "Inter"],
  Juventus: ["Juventus FC", "Juventus"],
  Lazio: ["SS Lazio", "Lazio"],
  Lecce: ["US Lecce", "Lecce"],
  Monza: ["AC Monza", "Monza"],
  Napoli: ["SSC Napoli", "Napoli"],
  "Parma Calcio 1913": ["Parma Calcio 1913", "Parma"],
  Roma: ["AS Roma", "Roma"],
  Torino: ["Torino FC", "Torino"],
  Udinese: ["Udinese Calcio", "Udinese"],
  Venezia: ["Venezia FC", "Venezia"],
  Verona: ["Hellas Verona FC", "Hellas Verona", "Verona"],

  // Ligue 1
  Angers: ["Angers SCO", "Angers"],
  Auxerre: ["AJ Auxerre", "Auxerre"],
  Brest: ["Stade Brestois 29", "Brest"],
  "Le Havre": ["Le Havre AC", "Le Havre"],
  Lens: ["RC Lens", "Lens"],
  Lille: ["Lille OSC", "LOSC Lille", "Lille"],
  Lyon: ["Olympique Lyonnais", "Lyon"],
  Marseille: ["Olympique de Marseille", "Marseille"],
  Monaco: ["AS Monaco FC", "AS Monaco", "Monaco"],
  Montpellier: ["Montpellier HSC", "Montpellier"],
  Nantes: ["FC Nantes", "Nantes"],
  Nice: ["OGC Nice", "Nice"],
  "Paris Saint Germain": [
    "Paris Saint-Germain FC",
    "Paris Saint-Germain",
    "PSG",
  ],
  Reims: ["Stade de Reims", "Reims"],
  Rennes: ["Stade Rennais FC 1901", "Stade Rennais", "Rennes"],
  "Saint-Etienne": ["AS Saint-Étienne", "Saint-Étienne", "Saint-Etienne"],
  Strasbourg: ["RC Strasbourg Alsace", "Strasbourg"],
  Toulouse: ["Toulouse FC", "Toulouse"],
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Given an Understat team name, return all possible DB name variants.
 * Used to match against our team.name and team.shortName columns.
 */
export function getCandidateNames(understatName: string): string[] {
  return UNDERSTAT_TO_CANONICAL[understatName] ?? [understatName];
}

/**
 * Build a reverse lookup: given a DB team name, find the Understat name.
 */
const reverseMap = new Map<string, string>();
for (const [usName, dbNames] of Object.entries(UNDERSTAT_TO_CANONICAL)) {
  for (const dbName of dbNames) {
    reverseMap.set(normalize(dbName), usName);
  }
  reverseMap.set(normalize(usName), usName);
}

export function getUnderstatName(dbTeamName: string): string | null {
  return reverseMap.get(normalize(dbTeamName)) ?? null;
}

/**
 * Fuzzy substring match: checks if the normalized target is contained within
 * the normalized candidate or vice versa.
 */
function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const wordsA = na.split(/\s+/);
  const wordsB = nb.split(/\s+/);
  const shared = wordsA.filter((w) => w.length > 3 && wordsB.includes(w));
  return shared.length >= 1 && shared.length >= Math.min(wordsA.length, wordsB.length) * 0.5;
}

/**
 * Match an Understat team name to a DB team record from a list.
 * Returns the DB team ID if found, null otherwise.
 */
export function matchTeamToDb(
  understatName: string,
  dbTeams: Array<{ id: number; name: string; shortName: string | null }>,
): number | null {
  const candidates = getCandidateNames(understatName);

  for (const team of dbTeams) {
    for (const candidate of candidates) {
      if (
        normalize(team.name) === normalize(candidate) ||
        (team.shortName && normalize(team.shortName) === normalize(candidate))
      ) {
        return team.id;
      }
    }
  }

  for (const team of dbTeams) {
    if (
      fuzzyMatch(team.name, understatName) ||
      (team.shortName && fuzzyMatch(team.shortName, understatName))
    ) {
      return team.id;
    }
  }

  return null;
}

/**
 * Match an Understat player to DB player records.
 * Uses exact name match first, then fuzzy match within a team.
 */
export function matchPlayerToDb(
  understatPlayerName: string,
  understatTeamName: string,
  dbPlayers: Array<{
    id: number;
    name: string;
    teamId: number;
  }>,
  teamIdMap: Map<string, number>,
): number | null {
  const teamId = teamIdMap.get(understatTeamName);

  const teamPlayers = teamId
    ? dbPlayers.filter((p) => p.teamId === teamId)
    : dbPlayers;

  for (const p of teamPlayers) {
    if (normalize(p.name) === normalize(understatPlayerName)) return p.id;
  }

  for (const p of teamPlayers) {
    if (fuzzyMatch(p.name, understatPlayerName)) return p.id;
  }

  return null;
}
