import { createHash } from 'node:crypto';

import type { ActionIntentV1 } from '@ai-ff/domain';

import { portalActionFromIntent, evaluateAutomationPolicy } from './policy.js';
import type { EspnPortalSnapshot, PortalAction } from './schemas.js';
import type {
  ActionExecutionResult,
  ActionLedger,
  EspnPortalAdapter,
  ExecutionContext,
  PortalBinding,
} from './types.js';

function digest(snapshot: EspnPortalSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function updatedIntent(
  intent: ActionIntentV1,
  status: ActionIntentV1['status'],
  now: string,
): ActionIntentV1 {
  return { ...intent, status, updatedAt: now };
}

function preconditions(
  snapshot: EspnPortalSnapshot,
  binding: PortalBinding,
  action: PortalAction,
): string[] {
  const reasons: string[] = [];
  if (!snapshot.signedIn) reasons.push('ESPN browser session is not signed in');
  if (snapshot.leagueId !== binding.leagueId) reasons.push('Observed ESPN league does not match');
  if (snapshot.teamId !== binding.teamId) reasons.push('Observed ESPN team does not match');

  const rosterById = new Map(snapshot.roster.map((entry) => [entry.playerId, entry]));
  const available = new Set(snapshot.availablePlayers.map((player) => player.playerId));
  switch (action.type) {
    case 'lineup_change': {
      const playerIn = rosterById.get(action.playerInId);
      const playerOut = rosterById.get(action.playerOutId);
      if (!playerIn || !playerOut) reasons.push('Lineup players are not both on the roster');
      if (playerIn?.locked || playerOut?.locked) reasons.push('A lineup player is locked');
      break;
    }
    case 'waiver_claim':
    case 'free_agent_move':
      if (!available.has(action.addPlayerId)) reasons.push('Add target is not an available player');
      if (action.dropPlayerId !== null && !rosterById.has(action.dropPlayerId)) {
        reasons.push('Drop target is not on the roster');
      }
      break;
    case 'draft_pick':
      if (snapshot.draft.status !== 'live') reasons.push('Draft is not live');
      if (snapshot.draft.onClockTeamId !== binding.teamId)
        reasons.push('Configured team is not on the clock');
      if (!available.has(action.playerId)) reasons.push('Draft target is not available');
      break;
    case 'trade_offer':
      if (action.sendPlayerIds.some((playerId) => !rosterById.has(playerId))) {
        reasons.push('At least one outgoing player is not on the roster');
      }
      break;
  }
  return reasons;
}

function verify(snapshot: EspnPortalSnapshot, action: PortalAction): boolean {
  switch (action.type) {
    case 'lineup_change':
      return snapshot.roster.some(
        (entry) => entry.playerId === action.playerInId && entry.slot === action.targetSlot,
      );
    case 'waiver_claim':
      return snapshot.waiverClaims.some((claim) => claim.actionId === action.actionId);
    case 'free_agent_move':
      return (
        snapshot.roster.some((entry) => entry.playerId === action.addPlayerId) &&
        (action.dropPlayerId === null ||
          !snapshot.roster.some((entry) => entry.playerId === action.dropPlayerId))
      );
    case 'draft_pick':
      return snapshot.draft.picks.some((pick) => pick.actionId === action.actionId);
    case 'trade_offer':
      return snapshot.tradeOffers.some((offer) => offer.actionId === action.actionId);
  }
}

export class EspnActionExecutor {
  constructor(
    readonly adapter: EspnPortalAdapter,
    readonly ledger: ActionLedger,
  ) {}

  async execute(context: ExecutionContext): Promise<ActionExecutionResult> {
    const prior = this.ledger.get(context.team.id, context.intent.idempotencyKey);
    if (prior) return { ...prior, performed: false, replayed: true };

    let action: PortalAction;
    try {
      action = portalActionFromIntent(context.intent);
    } catch (error) {
      return this.#finish(context, {
        outcome: 'failed',
        intent: updatedIntent(context.intent, 'failed', context.now),
        performed: false,
        replayed: false,
        beforeDigest: null,
        afterDigest: null,
        evidence: [error instanceof Error ? error.message : 'Invalid action payload'],
        errorCode: 'INVALID_ACTION_PAYLOAD',
      });
    }

    const policy = evaluateAutomationPolicy(context, action);
    if (!policy.approved) {
      return this.#finish(context, {
        outcome: 'cancelled',
        intent: updatedIntent(context.intent, 'cancelled', context.now),
        performed: false,
        replayed: false,
        beforeDigest: null,
        afterDigest: null,
        evidence: policy.reasons,
        errorCode: 'POLICY_DENIED',
      });
    }

    const binding = {
      leagueId: context.team.espnLeagueId,
      teamId: context.team.espnTeamId,
    };
    let before: EspnPortalSnapshot;
    try {
      before = await this.adapter.observe(binding);
    } catch (error) {
      return this.#finish(context, {
        outcome: 'needs_attention',
        intent: updatedIntent(context.intent, 'needs_attention', context.now),
        performed: false,
        replayed: false,
        beforeDigest: null,
        afterDigest: null,
        evidence: [error instanceof Error ? error.message : 'Could not observe ESPN'],
        errorCode: 'OBSERVATION_FAILED',
      });
    }

    const blocked = preconditions(before, binding, action);
    if (blocked.length > 0) {
      return this.#finish(context, {
        outcome: 'needs_attention',
        intent: updatedIntent(context.intent, 'needs_attention', context.now),
        performed: false,
        replayed: false,
        beforeDigest: digest(before),
        afterDigest: null,
        evidence: blocked,
        errorCode: 'PORTAL_PRECONDITION_FAILED',
      });
    }

    let portalResult;
    try {
      portalResult = await this.adapter.perform(binding, action);
    } catch (error) {
      return this.#finish(context, {
        outcome: 'needs_attention',
        intent: updatedIntent(context.intent, 'needs_attention', context.now),
        performed: true,
        replayed: false,
        beforeDigest: digest(before),
        afterDigest: null,
        evidence: [
          'ESPN action outcome is unknown; inspect the portal before any retry',
          error instanceof Error ? error.message : String(error),
        ],
        errorCode: 'ACTION_OUTCOME_UNKNOWN',
      });
    }

    let after: EspnPortalSnapshot;
    try {
      after = await this.adapter.observe(binding);
    } catch (error) {
      return this.#finish(context, {
        outcome: 'needs_attention',
        intent: updatedIntent(context.intent, 'needs_attention', context.now),
        performed: true,
        replayed: false,
        beforeDigest: digest(before),
        afterDigest: null,
        evidence: [
          ...portalResult.evidence,
          'Action was attempted but read-back failed; do not retry blindly',
          error instanceof Error ? error.message : String(error),
        ],
        errorCode: 'READBACK_FAILED',
      });
    }

    const verified = verify(after, action);
    const outcome = verified
      ? 'verified'
      : portalResult.status === 'rejected'
        ? 'failed'
        : 'needs_attention';
    return this.#finish(context, {
      outcome,
      intent: updatedIntent(context.intent, outcome, context.now),
      performed: true,
      replayed: false,
      beforeDigest: digest(before),
      afterDigest: digest(after),
      evidence: [
        ...portalResult.evidence,
        verified
          ? 'Post-action observation matched the exact intent'
          : 'Post-action observation did not prove the intended state',
      ],
      errorCode: verified
        ? null
        : (portalResult.errorCode ??
          (portalResult.status === 'rejected' ? 'PORTAL_REJECTED' : 'VERIFICATION_FAILED')),
    });
  }

  #finish(context: ExecutionContext, result: ActionExecutionResult): ActionExecutionResult {
    this.ledger.put(context.team.id, context.intent.idempotencyKey, result);
    return result;
  }
}
