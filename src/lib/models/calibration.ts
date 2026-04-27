export interface PlattCalibrator {
  weight: number;
  bias: number;
}

function clampProb(p: number): number {
  return Math.max(1e-6, Math.min(1 - 1e-6, p));
}

function sigmoid(x: number): number {
  if (x > 35) return 1;
  if (x < -35) return 0;
  return 1 / (1 + Math.exp(-x));
}

function logit(p: number): number {
  const clamped = clampProb(p);
  return Math.log(clamped / (1 - clamped));
}

export function fitPlattCalibrator(
  probabilities: number[],
  labels: number[],
  options?: { iterations?: number; learningRate?: number; l2?: number },
): PlattCalibrator {
  if (probabilities.length === 0 || probabilities.length !== labels.length) {
    return { weight: 1, bias: 0 };
  }

  let weight = 1;
  let bias = 0;
  const iterations = options?.iterations ?? 300;
  const learningRate = options?.learningRate ?? 0.05;
  const l2 = options?.l2 ?? 0.001;

  const transformed = probabilities.map((prob) => logit(prob));

  for (let iter = 0; iter < iterations; iter++) {
    let gradW = 0;
    let gradB = 0;

    for (let i = 0; i < transformed.length; i++) {
      const x = transformed[i] ?? 0;
      const y = labels[i] ?? 0;
      const pred = sigmoid(weight * x + bias);
      const error = pred - y;
      gradW += error * x;
      gradB += error;
    }

    const n = transformed.length;
    weight -= learningRate * ((gradW / n) + l2 * weight);
    bias -= learningRate * (gradB / n);
  }

  return { weight, bias };
}

export function applyPlattCalibration(
  calibrator: PlattCalibrator,
  probability: number,
): number {
  return sigmoid(calibrator.weight * logit(probability) + calibrator.bias);
}
