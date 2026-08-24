import type { CodexAppServerClient, JsonValue } from '@ai-ff/codex';

import {
  espnPortalSnapshotSchema,
  portalActionResultJsonSchema,
  portalActionResultSchema,
  portalSnapshotJsonSchema,
  type EspnPortalSnapshot,
  type PortalAction,
  type PortalActionResult,
} from './schemas.js';
import type { EspnPortalAdapter, PortalBinding } from './types.js';

export class CodexEspnPortalAdapter implements EspnPortalAdapter {
  constructor(
    readonly client: CodexAppServerClient,
    readonly threadId: string,
  ) {}

  async observe(binding: PortalBinding): Promise<EspnPortalSnapshot> {
    return await this.client.runStructuredTurn({
      threadId: this.threadId,
      prompt: [
        'Use the computer-use:computer-use skill to inspect the already-open ESPN Fantasy Football portal.',
        'This is observation only: do not click any control that submits or changes data.',
        `Confirm the visible league ID is ${binding.leagueId} and team ID is ${binding.teamId}.`,
        'Read the current roster with visible injury/availability status, available players with waiver/free-agent status and rostered percentage, pending waivers, outgoing trades, draft state and draft slot.',
        'Read visible remaining FAAB and this-week FAAB spend. Use null when ESPN does not display either value.',
        'Read each visible opponent team roster for trade analysis. Put opponents in leagueTeams and exclude the configured team.',
        'If a field cannot be verified from visible UI, use unknown or null where the schema permits it; never infer portal state.',
        'Do not use undocumented ESPN APIs. Return only the requested structured snapshot.',
      ].join('\n'),
      outputSchema: portalSnapshotJsonSchema as unknown as JsonValue,
      parse: (value) => espnPortalSnapshotSchema.parse(value),
    });
  }

  async perform(binding: PortalBinding, action: PortalAction): Promise<PortalActionResult> {
    return await this.client.runStructuredTurn({
      threadId: this.threadId,
      prompt: [
        'Use the computer-use:computer-use skill with the already-open ESPN Fantasy Football portal.',
        `Before acting, visibly confirm league ID ${binding.leagueId} and team ID ${binding.teamId}.`,
        `Execute this one exact, policy-approved action: ${JSON.stringify(action)}.`,
        'Do not accept an incoming trade. Do not use undocumented ESPN APIs.',
        'Make at most one submission attempt. If the result is unclear, stop and report ambiguous; never retry blindly.',
        'Return short text evidence without screenshots, cookies, tokens, or personal account details.',
      ].join('\n'),
      outputSchema: portalActionResultJsonSchema as unknown as JsonValue,
      parse: (value) => portalActionResultSchema.parse(value),
    });
  }
}
