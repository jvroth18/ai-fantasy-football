import type { LeagueRuleSetV1 } from '@ai-ff/domain';
import type { LineupAssignment } from '@ai-ff/rules';

import type { DecisionPlayer, RosterSlot } from './types.js';
import { riskAdjustedProjection } from './value.js';

export type LineupPlayer = DecisionPlayer & {
  currentSlot: RosterSlot;
  currentSlotIndex: number;
  locked: boolean;
  unavailable: boolean;
};

export type LineupRecommendation = {
  assignments: LineupAssignment[];
  changes: Array<{
    playerId: string;
    fromSlot: RosterSlot;
    fromSlotIndex: number;
    toSlot: RosterSlot;
    toSlotIndex: number;
  }>;
  p10: number;
  p50: number;
  p90: number;
  objective: number;
};

type ExpandedSlot = {
  slot: RosterSlot;
  slotIndex: number;
  eligiblePositions: DecisionPlayer['position'][];
};

function expandedStarterSlots(rules: LeagueRuleSetV1): ExpandedSlot[] {
  return rules.roster.flatMap((definition) =>
    definition.starter
      ? Array.from({ length: definition.count }, (_, slotIndex) => ({
          slot: definition.slot,
          slotIndex,
          eligiblePositions: definition.eligiblePositions,
        }))
      : [],
  );
}

export function optimizeLineup(
  rules: LeagueRuleSetV1,
  roster: LineupPlayer[],
  riskTolerance: number,
): LineupRecommendation | null {
  const slots = expandedStarterSlots(rules).sort(
    (left, right) => left.eligiblePositions.length - right.eligiblePositions.length,
  );
  const available = roster.filter((player) => !player.unavailable);
  const playerIndexes = new Map(available.map((player, index) => [player.playerId, index]));
  const lockedBySlot = new Map<string, LineupPlayer>();
  for (const player of available) {
    if (!player.locked) continue;
    const key = `${player.currentSlot}:${player.currentSlotIndex}`;
    if (lockedBySlot.has(key)) return null;
    lockedBySlot.set(key, player);
  }

  const memo = new Map<string, { score: number; assignments: LineupAssignment[] } | null>();
  function assign(
    slotOffset: number,
    used: bigint,
  ): { score: number; assignments: LineupAssignment[] } | null {
    if (slotOffset === slots.length) return { score: 0, assignments: [] };
    const key = `${slotOffset}:${used.toString()}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const slot = slots[slotOffset];
    if (!slot) return null;
    const locked = lockedBySlot.get(`${slot.slot}:${slot.slotIndex}`);
    const candidates = locked ? [locked] : available;
    let best: { score: number; assignments: LineupAssignment[] } | null = null;

    for (const player of candidates) {
      const index = playerIndexes.get(player.playerId);
      if (index === undefined || !slot.eligiblePositions.includes(player.position)) continue;
      const bit = 1n << BigInt(index);
      if ((used & bit) !== 0n) continue;
      if (
        player.locked &&
        (player.currentSlot !== slot.slot || player.currentSlotIndex !== slot.slotIndex)
      ) {
        continue;
      }
      const rest = assign(slotOffset + 1, used | bit);
      if (!rest) continue;
      const score = riskAdjustedProjection(player, riskTolerance) + rest.score;
      if (!best || score > best.score) {
        best = {
          score,
          assignments: [
            { playerId: player.playerId, slot: slot.slot, slotIndex: slot.slotIndex },
            ...rest.assignments,
          ],
        };
      }
    }
    memo.set(key, best);
    return best;
  }

  const solution = assign(0, 0n);
  if (!solution) return null;
  const playersById = new Map(roster.map((player) => [player.playerId, player]));
  const starters = solution.assignments
    .map((assignment) => playersById.get(assignment.playerId))
    .filter((player): player is LineupPlayer => player !== undefined);
  const changes = solution.assignments.flatMap((assignment) => {
    const player = playersById.get(assignment.playerId);
    if (
      !player ||
      (player.currentSlot === assignment.slot && player.currentSlotIndex === assignment.slotIndex)
    ) {
      return [];
    }
    return [
      {
        playerId: player.playerId,
        fromSlot: player.currentSlot,
        fromSlotIndex: player.currentSlotIndex,
        toSlot: assignment.slot,
        toSlotIndex: assignment.slotIndex,
      },
    ];
  });

  return {
    assignments: solution.assignments.sort(
      (left, right) => left.slot.localeCompare(right.slot) || left.slotIndex - right.slotIndex,
    ),
    changes,
    p10: Number(starters.reduce((sum, player) => sum + player.p10, 0).toFixed(3)),
    p50: Number(starters.reduce((sum, player) => sum + player.p50, 0).toFixed(3)),
    p90: Number(starters.reduce((sum, player) => sum + player.p90, 0).toFixed(3)),
    objective: Number(solution.score.toFixed(3)),
  };
}
