import { z } from 'zod';

import type { ActionIntentV1 } from '@ai-ff/domain';

import { portalActionSchema, type PortalAction } from './schemas.js';
import type { ExecutionContext, PolicyDecision } from './types.js';

const lineupPayloadSchema = z.object({
  playerInId: z.string().min(1),
  playerOutId: z.string().min(1),
  targetSlot: z.string().min(1),
});
const waiverPayloadSchema = z.object({
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).nullable(),
  bid: z.number().int().min(0).nullable(),
});
const freeAgentPayloadSchema = z.object({
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).nullable(),
  targetSlot: z.string().min(1).default('BENCH'),
});
const draftPayloadSchema = z.object({ playerId: z.string().min(1) });
const tradePayloadSchema = z.object({
  opponentTeamId: z.string().min(1),
  sendPlayerIds: z.array(z.string().min(1)).min(1),
  receivePlayerIds: z.array(z.string().min(1)).min(1),
});

export function portalActionFromIntent(intent: ActionIntentV1): PortalAction {
  switch (intent.type) {
    case 'lineup_change':
      return portalActionSchema.parse({
        actionId: intent.id,
        type: intent.type,
        ...lineupPayloadSchema.parse(intent.payload),
      });
    case 'waiver_claim':
      return portalActionSchema.parse({
        actionId: intent.id,
        type: intent.type,
        ...waiverPayloadSchema.parse(intent.payload),
      });
    case 'free_agent_move':
      return portalActionSchema.parse({
        actionId: intent.id,
        type: intent.type,
        ...freeAgentPayloadSchema.parse(intent.payload),
      });
    case 'draft_pick':
      return portalActionSchema.parse({
        actionId: intent.id,
        type: intent.type,
        ...draftPayloadSchema.parse(intent.payload),
      });
    case 'trade_offer':
      return portalActionSchema.parse({
        actionId: intent.id,
        type: intent.type,
        ...tradePayloadSchema.parse(intent.payload),
      });
  }
}

export function evaluateAutomationPolicy(
  context: ExecutionContext,
  action: PortalAction,
): PolicyDecision {
  const { automation } = context.team;
  const reasons: string[] = [];

  if (context.intent.teamId !== context.team.id) reasons.push('Intent belongs to a different team');
  if (!['proposed', 'policy_approved'].includes(context.intent.status)) {
    reasons.push(`Intent status ${context.intent.status} is not executable`);
  }
  if (!automation.armed) reasons.push('Automation is not armed');

  const enabled = {
    lineup_change: automation.lineupChanges,
    waiver_claim: automation.waiverClaims,
    free_agent_move: automation.freeAgentMoves,
    draft_pick: automation.draftPicks,
    trade_offer: automation.outgoingTradeOffers,
  }[action.type];
  if (!enabled) reasons.push(`${action.type} automation is disabled`);

  const now = Date.parse(context.now);
  const observed = Date.parse(context.dataObservedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed)) {
    reasons.push('Data freshness timestamps are invalid');
  } else {
    const ageMinutes = (now - observed) / 60_000;
    if (ageMinutes < -5) reasons.push('Data snapshot is unexpectedly in the future');
    if (ageMinutes > automation.minimumDataFreshnessMinutes) {
      reasons.push(`Data is ${Math.floor(ageMinutes)} minutes old`);
    }
  }

  if (action.type === 'waiver_claim' && action.bid !== null) {
    if (automation.maxFaabPerClaim !== null && action.bid > automation.maxFaabPerClaim) {
      reasons.push('FAAB bid exceeds the per-claim cap');
    }
    if (
      automation.maxFaabPerWeek !== null &&
      (context.faabSpentThisWeek ?? 0) + action.bid > automation.maxFaabPerWeek
    ) {
      reasons.push('FAAB bid exceeds the weekly cap');
    }
    if (
      context.faabRemaining !== undefined &&
      context.faabRemaining - action.bid < automation.minimumFaabReserve
    ) {
      reasons.push('FAAB bid would breach the configured reserve');
    }
  }

  return { approved: reasons.length === 0, reasons };
}
