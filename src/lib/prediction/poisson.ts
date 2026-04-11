/**
 * Dixon-Coles Adjusted Poisson Model
 *
 * Core goal-prediction model. Takes attack/defense ratings for each team,
 * produces a full scoreline probability matrix (truncated grid), from which all
 * derivative markets (1X2, O/U, BTTS, CS, HT/FT) are derived.
 */

/** Grid 0..MAX_GOALS-1 goals per side; larger grid reduces tail bias from truncation. */
const MAX_GOALS = 12;

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Dixon-Coles low-score correction.
 * Adjusts P(0-0), P(1-0), P(0-1), P(1-1) because basic Poisson
 * underestimates correlation between low-scoring outcomes.
 *
 * rho < 0 → more 0-0 / 1-1 than Poisson predicts (typical for defensive matchups)
 * rho > 0 → more 1-0 / 0-1 than Poisson predicts
 */
function dixonColesAdjustment(
  i: number,
  j: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (i === 0 && j === 0)
    return 1 - lambdaHome * lambdaAway * rho;
  if (i === 1 && j === 0)
    return 1 + lambdaAway * rho;
  if (i === 0 && j === 1)
    return 1 + lambdaHome * rho;
  if (i === 1 && j === 1)
    return 1 - rho;
  return 1;
}

export interface ScorelineMatrix {
  matrix: number[][];
  lambdaHome: number;
  lambdaAway: number;
}

/**
 * Build the full scoreline probability matrix using Dixon-Coles adjusted Poisson.
 *
 * @param lambdaHome - Expected goals for home team
 * @param lambdaAway - Expected goals for away team
 * @param rho - Dixon-Coles correlation parameter (typically -0.13 to -0.03)
 */
export function buildScorelineMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number = -0.05,
): ScorelineMatrix {
  const matrix: number[][] = [];

  for (let i = 0; i < MAX_GOALS; i++) {
    matrix[i] = [];
    for (let j = 0; j < MAX_GOALS; j++) {
      const pHome = poissonPmf(i, lambdaHome);
      const pAway = poissonPmf(j, lambdaAway);
      const dc = dixonColesAdjustment(i, j, lambdaHome, lambdaAway, rho);
      matrix[i][j] = Math.max(0, pHome * pAway * dc);
    }
  }

  // Normalize so probabilities sum to 1
  let total = 0;
  for (let i = 0; i < MAX_GOALS; i++)
    for (let j = 0; j < MAX_GOALS; j++)
      total += matrix[i][j];

  if (total > 0) {
    for (let i = 0; i < MAX_GOALS; i++)
      for (let j = 0; j < MAX_GOALS; j++)
        matrix[i][j] /= total;
  }

  return { matrix, lambdaHome, lambdaAway };
}

// ─── DERIVED PROBABILITIES ───────────────────────────────────────

export function matchResultProbs(m: ScorelineMatrix) {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i < MAX_GOALS; i++)
    for (let j = 0; j < MAX_GOALS; j++) {
      if (i > j) home += m.matrix[i][j];
      else if (i === j) draw += m.matrix[i][j];
      else away += m.matrix[i][j];
    }
  return { home, draw, away };
}

export function overUnderProbs(m: ScorelineMatrix) {
  const thresholds = [0.5, 1.5, 2.5, 3.5, 4.5];
  const result: Record<string, number> = {};

  for (const t of thresholds) {
    let over = 0;
    for (let i = 0; i < MAX_GOALS; i++)
      for (let j = 0; j < MAX_GOALS; j++)
        if (i + j > t) over += m.matrix[i][j];
    result[`over${t.toFixed(1).replace(".", "")}`] = over;
  }
  return result;
}

export function bttsProbs(m: ScorelineMatrix) {
  let bttsYes = 0;
  for (let i = 1; i < MAX_GOALS; i++)
    for (let j = 1; j < MAX_GOALS; j++)
      bttsYes += m.matrix[i][j];
  return { yes: bttsYes, no: 1 - bttsYes };
}

export function cleanSheetProbs(m: ScorelineMatrix) {
  let homeCs = 0, awayCs = 0;
  for (let i = 0; i < MAX_GOALS; i++) {
    homeCs += m.matrix[i][0]; // away scores 0
    awayCs += m.matrix[0][i]; // home scores 0
  }
  return { home: homeCs, away: awayCs };
}

export function topScorelines(m: ScorelineMatrix, n: number = 10) {
  const lines: { home: number; away: number; prob: number }[] = [];
  for (let i = 0; i < MAX_GOALS; i++)
    for (let j = 0; j < MAX_GOALS; j++)
      lines.push({ home: i, away: j, prob: m.matrix[i][j] });

  return lines.sort((a, b) => b.prob - a.prob).slice(0, n);
}

export function scorelineMap(m: ScorelineMatrix): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < MAX_GOALS; i++)
    for (let j = 0; j < MAX_GOALS; j++) {
      if (m.matrix[i][j] >= 0.001)
        map[`${i}-${j}`] = Math.round(m.matrix[i][j] * 10000) / 10000;
    }
  return map;
}

/**
 * HT/FT probabilities.
 * Model first-half lambda as ~42% of full-time lambda (empirical ratio)
 * and derive P(HT result, FT result).
 */
export function htFtProbs(
  lambdaHome: number,
  lambdaAway: number,
  rho: number = -0.05,
  /** Share of λ in first half (league-specific when available). */
  htGoalShare: number = 0.42,
) {
  const share = Math.min(0.48, Math.max(0.38, htGoalShare));
  const lhHt = lambdaHome * share;
  const laHt = lambdaAway * share;
  const lhSh = lambdaHome * (1 - share);
  const laSh = lambdaAway * (1 - share);

  const htMatrix = buildScorelineMatrix(lhHt, laHt, rho * 0.5);
  const shMatrix = buildScorelineMatrix(lhSh, laSh, rho * 0.5);

  const labels = ["H", "D", "A"];
  const results: Record<string, number> = {};

  for (const htRes of labels) {
    for (const ftRes of labels) {
      let prob = 0;
      for (let hi = 0; hi < MAX_GOALS; hi++)
        for (let hj = 0; hj < MAX_GOALS; hj++) {
          const htOk =
            (htRes === "H" && hi > hj) ||
            (htRes === "D" && hi === hj) ||
            (htRes === "A" && hi < hj);
          if (!htOk) continue;

          for (let si = 0; si < MAX_GOALS; si++)
            for (let sj = 0; sj < MAX_GOALS; sj++) {
              const fi = hi + si;
              const fj = hj + sj;
              const ftOk =
                (ftRes === "H" && fi > fj) ||
                (ftRes === "D" && fi === fj) ||
                (ftRes === "A" && fi < fj);
              if (!ftOk) continue;

              prob += htMatrix.matrix[hi][hj] * shMatrix.matrix[si][sj];
            }
        }
      results[`${htRes}/${ftRes}`] = Math.round(prob * 10000) / 10000;
    }
  }

  return results;
}
