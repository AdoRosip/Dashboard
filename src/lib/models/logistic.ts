export interface LogisticRegressionOptions {
  iterations?: number;
  learningRate?: number;
  l2?: number;
  sampleWeights?: number[];
}

export interface StandardizedDataset {
  means: number[];
  stdDevs: number[];
  rows: number[][];
}

export interface LogisticRegressionModel {
  weights: number[];
  bias: number;
  means: number[];
  stdDevs: number[];
}

function sigmoid(x: number): number {
  if (x > 35) return 1;
  if (x < -35) return 0;
  return 1 / (1 + Math.exp(-x));
}

function safeStdDev(value: number): number {
  return value > 1e-8 ? value : 1;
}

export function standardizeTrainingRows(rows: number[][]): StandardizedDataset {
  if (rows.length === 0) {
    return { means: [], stdDevs: [], rows: [] };
  }

  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, idx) => {
    const total = rows.reduce((sum, row) => sum + (row[idx] ?? 0), 0);
    return total / rows.length;
  });

  const stdDevs = Array.from({ length: width }, (_, idx) => {
    const variance =
      rows.reduce((sum, row) => {
        const diff = (row[idx] ?? 0) - means[idx]!;
        return sum + diff * diff;
      }, 0) / rows.length;
    return safeStdDev(Math.sqrt(variance));
  });

  return {
    means,
    stdDevs,
    rows: rows.map((row) => row.map((value, idx) => ((value ?? 0) - means[idx]!) / stdDevs[idx]!)),
  };
}

export function standardizeWithModel(row: number[], model: LogisticRegressionModel): number[] {
  return row.map((value, idx) => ((value ?? 0) - (model.means[idx] ?? 0)) / (model.stdDevs[idx] ?? 1));
}

export function trainLogisticRegression(
  rows: number[][],
  labels: number[],
  options?: LogisticRegressionOptions,
): LogisticRegressionModel {
  if (rows.length === 0 || rows.length !== labels.length) {
    return { weights: [], bias: 0, means: [], stdDevs: [] };
  }

  const standardized = standardizeTrainingRows(rows);
  const width = standardized.rows[0]?.length ?? 0;
  const weights = Array.from({ length: width }, () => 0);
  let bias = 0;

  const iterations = options?.iterations ?? 500;
  const learningRate = options?.learningRate ?? 0.05;
  const l2 = options?.l2 ?? 0.001;
  const sampleWeights =
    options?.sampleWeights && options.sampleWeights.length === rows.length
      ? options.sampleWeights
      : Array.from({ length: rows.length }, () => 1);

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = Array.from({ length: width }, () => 0);
    let gradB = 0;
    let totalWeight = 0;

    for (let i = 0; i < standardized.rows.length; i++) {
      const row = standardized.rows[i]!;
      const y = labels[i] ?? 0;
      const weight = sampleWeights[i] ?? 1;
      const score = row.reduce((sum, value, idx) => sum + value * (weights[idx] ?? 0), bias);
      const pred = sigmoid(score);
      const error = (pred - y) * weight;
      totalWeight += weight;
      gradB += error;
      for (let j = 0; j < width; j++) {
        gradW[j]! += error * (row[j] ?? 0);
      }
    }

    const n = Math.max(totalWeight, 1);
    for (let j = 0; j < width; j++) {
      weights[j]! -= learningRate * ((gradW[j]! / n) + l2 * weights[j]!);
    }
    bias -= learningRate * (gradB / n);
  }

  return {
    weights,
    bias,
    means: standardized.means,
    stdDevs: standardized.stdDevs,
  };
}

export function predictLogisticRegression(model: LogisticRegressionModel, row: number[]): number {
  if (model.weights.length === 0) return 0.5;
  const normalized = standardizeWithModel(row, model);
  const score = normalized.reduce(
    (sum, value, idx) => sum + value * (model.weights[idx] ?? 0),
    model.bias,
  );
  return sigmoid(score);
}
