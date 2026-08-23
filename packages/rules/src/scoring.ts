import type { LeagueRuleSetV1, ScoringRule } from '@ai-ff/domain';

export type PlayerStatLine = Record<string, number | undefined>;

export type ScoringBreakdownItem = {
  stat: string;
  label: string;
  value: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
};

export type ScoringResult = {
  total: number;
  breakdown: ScoringBreakdownItem[];
  unscoredStats: string[];
};

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function clamp(value: number, rule: ScoringRule): number {
  const aboveMinimum = rule.minimum === undefined ? value : Math.max(value, rule.minimum);
  return rule.maximum === undefined ? aboveMinimum : Math.min(aboveMinimum, rule.maximum);
}

function bonusPoints(value: number, rule: ScoringRule): number {
  return rule.bonuses.reduce((total, bonus) => {
    const qualifies =
      bonus.mode === 'at_least'
        ? value >= bonus.threshold
        : bonus.mode === 'exactly'
          ? value === bonus.threshold
          : value >= bonus.threshold && value <= (bonus.upperThreshold ?? bonus.threshold);
    return qualifies ? total + bonus.points : total;
  }, 0);
}

export function scoreStatLine(
  scoringRules: LeagueRuleSetV1['scoring'],
  statLine: PlayerStatLine,
): ScoringResult {
  const scored = new Set<string>();
  const breakdown = scoringRules.map((rule) => {
    const rawValue = statLine[rule.stat] ?? 0;
    const value = clamp(rawValue, rule);
    const basePoints = (value / rule.unitSize) * rule.pointsPerUnit;
    const bonuses = bonusPoints(rawValue, rule);
    scored.add(rule.stat);

    return {
      stat: rule.stat,
      label: rule.label,
      value: rawValue,
      basePoints: roundScore(basePoints),
      bonusPoints: roundScore(bonuses),
      totalPoints: roundScore(basePoints + bonuses),
    };
  });

  return {
    total: roundScore(breakdown.reduce((total, item) => total + item.totalPoints, 0)),
    breakdown,
    unscoredStats: Object.keys(statLine)
      .filter((stat) => !scored.has(stat))
      .sort(),
  };
}
