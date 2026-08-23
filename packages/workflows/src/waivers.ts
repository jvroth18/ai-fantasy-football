import type { AutomationPolicy, LeagueRuleSetV1, StrategyProfileV1 } from '@ai-ff/domain';

import type { DecisionPlayer, RankedDecision } from './types.js';
import { riskAdjustedProjection, valueOverReplacement } from './value.js';

export type WaiverCandidate = DecisionPlayer & {
  addTrend: number;
  rosteredPercent: number;
  claimRequired: boolean;
};

export type DropCandidate = DecisionPlayer & {
  protected: boolean;
  locked: boolean;
  starter: boolean;
};

export type WaiverContext = {
  candidates: WaiverCandidate[];
  drops: DropCandidate[];
  strategy: StrategyProfileV1;
  automation: AutomationPolicy;
  waivers: LeagueRuleSetV1['waivers'];
  faabRemaining: number | null;
  faabSpentThisWeek: number;
};

export type WaiverRecommendation = RankedDecision<{
  add: WaiverCandidate;
  drop: DropCandidate | null;
  projectedPointDelta: number;
  bid: number | null;
  actionType: 'waiver_claim' | 'free_agent_move';
}>;

function suggestedBid(
  context: WaiverContext,
  delta: number,
  candidate: WaiverCandidate,
): number | null {
  if (
    !candidate.claimRequired ||
    context.waivers.type === 'rolling' ||
    context.waivers.budget === null
  ) {
    return null;
  }
  const remaining = context.faabRemaining ?? context.waivers.budget;
  const availableAfterReserve = Math.max(0, remaining - context.automation.minimumFaabReserve);
  const weeklyRoom =
    context.automation.maxFaabPerWeek === null
      ? availableAfterReserve
      : Math.max(0, context.automation.maxFaabPerWeek - context.faabSpentThisWeek);
  const claimRoom = context.automation.maxFaabPerClaim ?? availableAfterReserve;
  const ceiling = Math.min(availableAfterReserve, weeklyRoom, claimRoom);
  const demand = Math.min(1, candidate.rosteredPercent / 100 + Math.log1p(candidate.addTrend) / 20);
  const valueFraction = Math.min(0.35, Math.max(0.01, delta / Math.max(1, candidate.p50)));
  const aggression = 0.5 + context.strategy.faabAggressiveness;
  const raw = Math.ceil(remaining * valueFraction * aggression * (0.6 + demand));
  return Math.max(context.waivers.minimumBid, Math.min(ceiling, raw));
}

export function rankWaiverMoves(context: WaiverContext): WaiverRecommendation[] {
  const eligibleDrops = context.drops.filter(
    (player) =>
      !player.protected &&
      !player.locked &&
      !context.strategy.protectedPlayerIds.includes(player.playerId),
  );

  return context.candidates
    .filter((candidate) => !context.strategy.blockedPlayerIds.includes(candidate.playerId))
    .flatMap<WaiverRecommendation>((candidate) => {
      const candidateValue = riskAdjustedProjection(candidate, context.strategy.riskTolerance);
      const possibleDrops: Array<DropCandidate | null> =
        eligibleDrops.length > 0 ? eligibleDrops : [null];
      return possibleDrops.map((drop) => {
        const dropValue = drop
          ? riskAdjustedProjection(drop, context.strategy.riskTolerance) * (drop.starter ? 1.15 : 1)
          : 0;
        const delta = candidateValue - dropValue;
        const trendBonus = Math.min(4, Math.log1p(candidate.addTrend) * 0.7);
        const upsideBonus =
          candidate.breakoutScore * Math.max(0, candidate.p90 - candidate.p50) * 0.25;
        const churnPenalty = drop ? (1 - context.strategy.benchChurn) * 2 : 0;
        const score = delta + trendBonus + upsideBonus - churnPenalty;
        const reasons = [
          `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} risk-adjusted points versus the drop`,
          `${candidate.addTrend} recent adds`,
        ];
        if (candidate.breakoutScore >= 0.65) reasons.push('breakout profile');
        if (drop?.starter) reasons.push('requires dropping a current starter');
        const bid = suggestedBid(context, Math.max(0, delta), candidate);
        return {
          add: candidate,
          drop,
          projectedPointDelta: Number(delta.toFixed(3)),
          bid,
          actionType: candidate.claimRequired ? 'waiver_claim' : 'free_agent_move',
          score: Number(score.toFixed(3)),
          reasons,
        };
      });
    })
    .filter((recommendation) => recommendation.projectedPointDelta > 0)
    .sort((left, right) => right.score - left.score)
    .filter(
      (recommendation, index, all) =>
        all.findIndex((candidate) => candidate.add.playerId === recommendation.add.playerId) ===
        index,
    );
}

export function replacementFloor(players: DecisionPlayer[], riskTolerance: number): number {
  if (players.length === 0) return 0;
  return Math.min(...players.map((player) => valueOverReplacement(player, riskTolerance)));
}
