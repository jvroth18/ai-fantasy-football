import type { DecisionPlayer, Position, TeamNeeds } from './types.js';

export function riskAdjustedProjection(player: DecisionPlayer, riskTolerance: number): number {
  const boundedRisk = Math.max(0, Math.min(1, riskTolerance));
  const upside = player.p90 - player.p50;
  const downside = player.p50 - player.p10;
  return (
    player.p50 +
    boundedRisk * upside * 0.45 -
    (1 - boundedRisk) * downside * 0.45 -
    player.injuryRisk * player.p50 * 0.2 -
    player.bustRisk * player.p50 * 0.15 +
    player.breakoutScore * Math.max(0, upside) * 0.2
  );
}

export function valueOverReplacement(player: DecisionPlayer, riskTolerance: number): number {
  return riskAdjustedProjection(player, riskTolerance) - player.replacementValue;
}

export function needAdjustedValue(
  player: DecisionPlayer,
  needs: TeamNeeds,
  riskTolerance: number,
): number {
  const multiplier = Math.max(0.6, Math.min(1.6, needs[player.position] ?? 1));
  return valueOverReplacement(player, riskTolerance) * multiplier;
}

export function positionCounts(
  players: Pick<DecisionPlayer, 'position'>[],
): Record<Position, number> {
  const counts = {} as Record<Position, number>;
  for (const player of players) counts[player.position] = (counts[player.position] ?? 0) + 1;
  return counts;
}
