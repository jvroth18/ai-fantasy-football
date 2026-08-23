import type { LeagueRuleSetV1 } from '@ai-ff/domain';

export type RosterPlayer = {
  playerId: string;
  position: LeagueRuleSetV1['roster'][number]['eligiblePositions'][number];
};

export type LineupAssignment = {
  playerId: string;
  slot: LeagueRuleSetV1['roster'][number]['slot'];
  slotIndex: number;
};

export type LineupViolation = {
  code: 'unknown_player' | 'duplicate_player' | 'unknown_slot' | 'ineligible_position';
  message: string;
  playerId?: string;
  slot?: string;
  slotIndex?: number;
};

export type LineupValidation = {
  valid: boolean;
  violations: LineupViolation[];
};

type ExpandedSlot = {
  slot: LineupAssignment['slot'];
  slotIndex: number;
  eligiblePositions: RosterPlayer['position'][];
};

function starterSlots(rules: LeagueRuleSetV1): ExpandedSlot[] {
  return rules.roster.flatMap((definition) => {
    if (!definition.starter) return [];
    return Array.from({ length: definition.count }, (_, slotIndex) => ({
      slot: definition.slot,
      slotIndex,
      eligiblePositions: definition.eligiblePositions,
    }));
  });
}

export function validateLineup(
  rules: LeagueRuleSetV1,
  roster: RosterPlayer[],
  assignments: LineupAssignment[],
): LineupValidation {
  const violations: LineupViolation[] = [];
  const rosterById = new Map(roster.map((player) => [player.playerId, player]));
  const slotByKey = new Map(
    starterSlots(rules).map((slot) => [`${slot.slot}:${slot.slotIndex}`, slot] as const),
  );
  const usedPlayers = new Set<string>();

  for (const assignment of assignments) {
    const player = rosterById.get(assignment.playerId);
    const slot = slotByKey.get(`${assignment.slot}:${assignment.slotIndex}`);

    if (!player) {
      violations.push({
        code: 'unknown_player',
        playerId: assignment.playerId,
        message: `Player ${assignment.playerId} is not on this roster`,
      });
      continue;
    }
    if (usedPlayers.has(player.playerId)) {
      violations.push({
        code: 'duplicate_player',
        playerId: player.playerId,
        message: `Player ${player.playerId} is assigned more than once`,
      });
    }
    usedPlayers.add(player.playerId);

    if (!slot) {
      violations.push({
        code: 'unknown_slot',
        slot: assignment.slot,
        slotIndex: assignment.slotIndex,
        message: `Slot ${assignment.slot}:${assignment.slotIndex} is not a configured starter slot`,
      });
      continue;
    }
    if (!slot.eligiblePositions.includes(player.position)) {
      violations.push({
        code: 'ineligible_position',
        playerId: player.playerId,
        slot: slot.slot,
        slotIndex: slot.slotIndex,
        message: `${player.position} is not eligible for ${slot.slot}:${slot.slotIndex}`,
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

export function findLegalStarterAssignments(
  rules: LeagueRuleSetV1,
  roster: RosterPlayer[],
): LineupAssignment[] | null {
  const slots = starterSlots(rules).sort(
    (left, right) => left.eligiblePositions.length - right.eligiblePositions.length,
  );
  if (roster.length < slots.length) return null;

  const used = new Set<string>();
  const assignments: LineupAssignment[] = [];

  function assign(slotIndex: number): boolean {
    if (slotIndex === slots.length) return true;
    const slot = slots[slotIndex];
    if (!slot) return false;

    const candidates = roster.filter(
      (player) => !used.has(player.playerId) && slot.eligiblePositions.includes(player.position),
    );
    for (const player of candidates) {
      used.add(player.playerId);
      assignments.push({ playerId: player.playerId, slot: slot.slot, slotIndex: slot.slotIndex });
      if (assign(slotIndex + 1)) return true;
      assignments.pop();
      used.delete(player.playerId);
    }
    return false;
  }

  return assign(0) ? assignments : null;
}
