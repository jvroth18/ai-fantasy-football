import type { LeagueRuleSetV1, PlayerIdentityV1 } from '@ai-ff/domain';

export type Position = PlayerIdentityV1['position'];
export type RosterSlot = LeagueRuleSetV1['roster'][number]['slot'];

export type DecisionPlayer = {
  playerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  byeWeek: number | null;
  p10: number;
  p50: number;
  p90: number;
  replacementValue: number;
  adp: number | null;
  tier: number;
  injuryRisk: number;
  breakoutScore: number;
  bustRisk: number;
  mappingConfidence: number;
};

export type RankedDecision<T> = T & {
  score: number;
  reasons: string[];
};

export type TeamNeeds = Partial<Record<Position, number>>;
