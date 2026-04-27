import type { ValuePolicy } from "../odds/value";

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MVP_PRODUCTION_POLICY_VERSION =
  process.env.MVP_PRODUCTION_POLICY_VERSION ?? "mvp_1x2_v1";

export const MVP_PRODUCTION_POLICY: ValuePolicy = {
  minEdge: readEnvNumber("MVP_VALUE_MIN_EDGE", 0.03),
  minExpectedValue: readEnvNumber("MVP_VALUE_MIN_EV", 0),
  minModelConfidence: readEnvNumber("MVP_VALUE_MIN_CONFIDENCE", 0.55),
  minModelProb: readEnvNumber("MVP_VALUE_MIN_MODEL_PROB", 0.18),
  minOdds: readEnvNumber("MVP_VALUE_MIN_ODDS", 1.3),
  maxKellyFraction: readEnvNumber("MVP_VALUE_MAX_KELLY", 0.08),
};

export function serializeMvpProductionPolicy() {
  return JSON.stringify({
    version: MVP_PRODUCTION_POLICY_VERSION,
    policy: MVP_PRODUCTION_POLICY,
  });
}
