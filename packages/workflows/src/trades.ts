import type { StrategyProfileV1 } from '@ai-ff/domain';

import type { DecisionPlayer, TeamNeeds } from './types.js';
import { needAdjustedValue, valueOverReplacement } from './value.js';

export type TradeRoster = {
  teamId: string;
  players: DecisionPlayer[];
  needs: TeamNeeds;
};

export type TradeProposal = {
  opponentTeamId: string;
  send: DecisionPlayer[];
  receive: DecisionPlayer[];
  marketValueSent: number;
  marketValueReceived: number;
  fairnessRatio: number;
  projectedGain: number;
  opponentProjectedGain: number;
  score: number;
  reasons: string[];
};

function combinations(players: DecisionPlayer[]): DecisionPlayer[][] {
  const result = players.map((player) => [player]);
  for (let left = 0; left < players.length; left += 1) {
    for (let right = left + 1; right < players.length; right += 1) {
      const first = players[left];
      const second = players[right];
      if (first && second) result.push([first, second]);
    }
  }
  return result;
}

function total(players: DecisionPlayer[], value: (player: DecisionPlayer) => number): number {
  return players.reduce((sum, player) => sum + Math.max(0, value(player)), 0);
}

export function generateTradeProposals(
  own: TradeRoster,
  opponents: TradeRoster[],
  strategy: StrategyProfileV1,
  maximum = 8,
): TradeProposal[] {
  const ownTradeable = own.players
    .filter((player) => !strategy.protectedPlayerIds.includes(player.playerId))
    .slice(0, 12);
  const ownPackages = combinations(ownTradeable);
  const proposals: TradeProposal[] = [];

  for (const opponent of opponents) {
    const opponentPackages = combinations(opponent.players.slice(0, 12));
    for (const send of ownPackages) {
      for (const receive of opponentPackages) {
        if (receive.some((player) => strategy.blockedPlayerIds.includes(player.playerId))) continue;
        const marketSent = total(send, (player) => valueOverReplacement(player, 0.5));
        const marketReceived = total(receive, (player) => valueOverReplacement(player, 0.5));
        if (marketSent <= 0 || marketReceived <= 0) continue;
        const fairness = marketReceived / marketSent;
        if (fairness < 0.85 || fairness > 1.15) continue;

        const ownOutgoing = total(send, (player) =>
          needAdjustedValue(player, own.needs, strategy.riskTolerance),
        );
        const ownIncoming = total(receive, (player) =>
          needAdjustedValue(player, own.needs, strategy.riskTolerance),
        );
        const opponentOutgoing = total(receive, (player) =>
          needAdjustedValue(player, opponent.needs, 0.5),
        );
        const opponentIncoming = total(send, (player) =>
          needAdjustedValue(player, opponent.needs, 0.5),
        );
        const ownGain = ownIncoming - ownOutgoing;
        const opponentGain = opponentIncoming - opponentOutgoing;
        if (ownGain <= 0 || opponentGain < 0) continue;

        const targetBonus = receive.some((player) =>
          strategy.targetPlayerIds.includes(player.playerId),
        )
          ? 3
          : 0;
        const balancePenalty = Math.abs(1 - fairness) * 10;
        const score = ownGain + opponentGain * 0.35 + targetBonus - balancePenalty;
        proposals.push({
          opponentTeamId: opponent.teamId,
          send,
          receive,
          marketValueSent: Number(marketSent.toFixed(3)),
          marketValueReceived: Number(marketReceived.toFixed(3)),
          fairnessRatio: Number(fairness.toFixed(3)),
          projectedGain: Number(ownGain.toFixed(3)),
          opponentProjectedGain: Number(opponentGain.toFixed(3)),
          score: Number(score.toFixed(3)),
          reasons: [
            `addresses ${receive.map((player) => player.position).join('/')} need`,
            `${Math.round(fairness * 100)}% market-value ratio`,
            `projects +${ownGain.toFixed(1)} roster utility`,
          ],
        });
      }
    }
  }

  return proposals
    .sort((left, right) => right.score - left.score)
    .filter((proposal, index, all) => {
      const key = `${proposal.opponentTeamId}:${proposal.send
        .map((player) => player.playerId)
        .sort()
        .join(',')}:${proposal.receive
        .map((player) => player.playerId)
        .sort()
        .join(',')}`;
      return (
        all.findIndex(
          (candidate) =>
            `${candidate.opponentTeamId}:${candidate.send
              .map((player) => player.playerId)
              .sort()
              .join(',')}:${candidate.receive
              .map((player) => player.playerId)
              .sort()
              .join(',')}` === key,
        ) === index
      );
    })
    .slice(0, maximum);
}
