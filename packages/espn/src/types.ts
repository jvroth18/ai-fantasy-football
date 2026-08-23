import type { ActionIntentV1, TeamConfigV1 } from '@ai-ff/domain';

import type { EspnPortalSnapshot, PortalAction, PortalActionResult } from './schemas.js';

export interface EspnPortalAdapter {
  observe(binding: PortalBinding): Promise<EspnPortalSnapshot>;
  perform(binding: PortalBinding, action: PortalAction): Promise<PortalActionResult>;
}

export type PortalBinding = {
  leagueId: string;
  teamId: string;
};

export type ExecutionContext = {
  team: TeamConfigV1;
  intent: ActionIntentV1;
  dataObservedAt: string;
  now: string;
  faabRemaining?: number;
  faabSpentThisWeek?: number;
};

export type PolicyDecision = {
  approved: boolean;
  reasons: string[];
};

export type ActionExecutionOutcome = 'verified' | 'failed' | 'needs_attention' | 'cancelled';

export type ActionExecutionResult = {
  outcome: ActionExecutionOutcome;
  intent: ActionIntentV1;
  performed: boolean;
  replayed: boolean;
  beforeDigest: string | null;
  afterDigest: string | null;
  evidence: string[];
  errorCode: string | null;
};

export interface ActionLedger {
  get(teamId: string, idempotencyKey: string): ActionExecutionResult | undefined;
  put(teamId: string, idempotencyKey: string, result: ActionExecutionResult): void;
}
