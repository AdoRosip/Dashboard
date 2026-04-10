export const FLAG_EFFECTS: Record<
  string,
  { lambdaMultiplier: number; durationDays: number; description: string }
> = {
  manager_sacked: {
    lambdaMultiplier: 1.08,
    durationDays: 21,
    description: "New manager bounce — historically +8% win rate for ~3 matches",
  },
  manager_appointed_top: {
    lambdaMultiplier: 1.05,
    durationDays: 42,
    description: "High-profile appointment — squad motivation boost",
  },
  manager_appointed_unknown: {
    lambdaMultiplier: 0.97,
    durationDays: 28,
    description: "Unknown quantity — tactical uncertainty",
  },
  caretaker_manager: {
    lambdaMultiplier: 1.06,
    durationDays: 14,
    description: "Caretaker bounce — short-term motivation spike",
  },
  key_player_sold: {
    lambdaMultiplier: 0.93,
    durationDays: 28,
    description: "Lost key contributor — squad adjustment period",
  },
  key_player_signed: {
    lambdaMultiplier: 1.03,
    durationDays: 21,
    description: "Major signing — may take time to integrate",
  },
  multiple_starters_sold: {
    lambdaMultiplier: 0.88,
    durationDays: 42,
    description: "Major squad overhaul — significant disruption expected",
  },
  dressing_room_unrest: {
    lambdaMultiplier: 0.94,
    durationDays: 14,
    description: "Reported internal issues — concentration affected",
  },
  contract_dispute_key_player: {
    lambdaMultiplier: 0.97,
    durationDays: 30,
    description: "Key player unsettled — potential reduced effort",
  },
  formation_change: {
    lambdaMultiplier: 0.96,
    durationDays: 14,
    description: "Major system change — teething problems expected",
  },
  extreme_weather: {
    lambdaMultiplier: 0.95,
    durationDays: 1,
    description: "Heavy rain/snow/wind — favors defensive teams, reduces goals",
  },
  neutral_venue: {
    lambdaMultiplier: 1.0,
    durationDays: 1,
    description: "Neutral venue — home advantage set to zero",
  },
  behind_closed_doors: {
    lambdaMultiplier: 0.98,
    durationDays: 1,
    description: "No fans — reduced home advantage",
  },
  pitch_condition_poor: {
    lambdaMultiplier: 0.96,
    durationDays: 1,
    description: "Poor pitch — reduces quality of play, favors physicality",
  },
};
