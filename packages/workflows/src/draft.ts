import type { AutomationPolicy, LeagueRuleSetV1, StrategyProfileV1 } from '@ai-ff/domain';

import type { DecisionPlayer, RankedDecision } from './types.js';
import { positionCounts, valueOverReplacement } from './value.js';

export type DraftContext = {
  overallPick: number;
  picksUntilNext: number;
  roster: DecisionPlayer[];
  rules: LeagueRuleSetV1;
  strategy: StrategyProfileV1;
  automation: AutomationPolicy;
};

export type DraftRanking = RankedDecision<{
  player: DecisionPlayer;
  valueOverReplacement: number;
  reach: number;
  chanceAvailableNextPick: number;
  autoPickEligible: boolean;
}>;

function starterDemand(rules: LeagueRuleSetV1, position: DecisionPlayer['position']): number {
  return rules.roster.reduce((total, slot) => {
    if (!slot.starter || !slot.eligiblePositions.includes(position)) return total;
    return total + slot.count / slot.eligiblePositions.length;
  }, 0);
}

function chanceAvailable(adp: number | null, nextPick: number): number {
  if (adp === null) return 0.5;
  return 1 / (1 + Math.exp(-(adp - nextPick) / 5));
}

export function rankDraftCandidates(
  candidates: DecisionPlayer[],
  context: DraftContext,
): DraftRanking[] {
  const counts = positionCounts(context.roster);
  const rosterTeams = new Set(context.roster.map((player) => player.nflTeam).filter(Boolean));
  const nextPick = context.overallPick + context.picksUntilNext;

  return candidates
    .map<DraftRanking>((player) => {
      const reasons: string[] = [];
      const vor = valueOverReplacement(player, context.strategy.riskTolerance);
      const demand = starterDemand(context.rules, player.position);
      const need = Math.max(0, demand - (counts[player.position] ?? 0));
      const needBonus = need * 4;
      const scarcityBonus = Math.max(0, 5 - player.tier) * 0.45;
      const adpValue =
        player.adp === null ? 0 : Math.max(-12, Math.min(20, context.overallPick - player.adp));
      const survival = chanceAvailable(player.adp, nextPick);
      const urgencyBonus = (1 - survival) * Math.max(0, vor) * 0.25;
      const reach =
        player.adp === null ? 0 : Math.max(0, Math.round(player.adp - context.overallPick));
      const reachPenalty = Math.max(0, reach - context.automation.maximumDraftReach) * 1.5;
      const targetBonus = context.strategy.targetPlayerIds.includes(player.playerId) ? 8 : 0;
      const blocked = context.strategy.blockedPlayerIds.includes(player.playerId);
      const stackBonus =
        context.strategy.preferStacks && player.nflTeam && rosterTeams.has(player.nflTeam)
          ? 1.5
          : 0;
      const positionWeight = context.strategy.positionWeights[player.position] ?? 1;
      const confidencePenalty = (1 - player.mappingConfidence) * 10;

      if (vor > 0) reasons.push(`${vor.toFixed(1)} value over replacement`);
      if (need > 0) reasons.push(`fills ${player.position} starter demand`);
      if (survival < 0.35) reasons.push('unlikely to survive to the next pick');
      if (adpValue > 4) reasons.push('fell past market ADP');
      if (targetBonus > 0) reasons.push('strategy target');
      if (stackBonus > 0) reasons.push('preferred team stack');
      if (reachPenalty > 0) reasons.push('exceeds configured draft reach');
      if (blocked) reasons.push('blocked by strategy');

      const score = blocked
        ? Number.NEGATIVE_INFINITY
        : vor * positionWeight +
          needBonus +
          scarcityBonus +
          adpValue * 0.3 +
          urgencyBonus +
          targetBonus +
          stackBonus -
          reachPenalty -
          confidencePenalty;
      return {
        player,
        valueOverReplacement: Number(vor.toFixed(3)),
        reach,
        chanceAvailableNextPick: Number(survival.toFixed(3)),
        autoPickEligible:
          !blocked &&
          reach <= context.automation.maximumDraftReach &&
          player.mappingConfidence >= 0.9,
        score: Number(score.toFixed(3)),
        reasons,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.player.name.localeCompare(right.player.name),
    );
}

export function picksUntilNextSnakeTurn(
  overallPick: number,
  draftSlot: number,
  teamCount: number,
): number {
  if (draftSlot < 1 || draftSlot > teamCount) throw new Error('Draft slot is outside the league');
  if (overallPick < 1) throw new Error('Overall pick must be positive');
  for (let candidate = overallPick + 1; candidate <= overallPick + teamCount * 2; candidate += 1) {
    const round = Math.floor((candidate - 1) / teamCount) + 1;
    const index = (candidate - 1) % teamCount;
    const owner = round % 2 === 1 ? index + 1 : teamCount - index;
    if (owner === draftSlot) return candidate - overallPick;
  }
  throw new Error('Could not resolve the next snake-draft turn');
}
