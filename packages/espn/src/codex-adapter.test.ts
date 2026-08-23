import type { CodexAppServerClient, StructuredTurnRequest } from '@ai-ff/codex';
import { describe, expect, it } from 'vitest';

import { CodexEspnPortalAdapter } from './codex-adapter.js';
import { snapshotFixture } from './test-fixtures.js';
import type { PortalAction } from './schemas.js';

describe('Codex ESPN adapter', () => {
  it('constrains observation and mutation turns to the exact visible binding', async () => {
    const requests: StructuredTurnRequest<unknown>[] = [];
    const fakeClient = {
      async runStructuredTurn<T>(request: StructuredTurnRequest<T>): Promise<T> {
        requests.push(request as StructuredTurnRequest<unknown>);
        const value =
          requests.length === 1
            ? snapshotFixture()
            : { status: 'submitted', evidence: ['Offer confirmation appeared'], errorCode: null };
        return request.parse(value);
      },
    } as unknown as CodexAppServerClient;
    const adapter = new CodexEspnPortalAdapter(fakeClient, 'thread-1');
    const binding = { leagueId: 'league-1', teamId: 'team-7' };

    await adapter.observe(binding);
    const action: PortalAction = {
      actionId: '37a0cb57-e4b4-40fc-850f-8d15f2b31d91',
      type: 'trade_offer',
      opponentTeamId: 'team-3',
      sendPlayerIds: ['starter-rb'],
      receivePlayerIds: ['opponent-wr'],
    };
    await adapter.perform(binding, action);

    expect(requests[0]?.prompt).toContain('observation only');
    expect(requests[0]?.prompt).toContain('league ID is league-1 and team ID is team-7');
    expect(requests[1]?.prompt).toContain(JSON.stringify(action));
    expect(requests[1]?.prompt).toContain('Make at most one submission attempt');
    expect(requests[1]?.prompt).toContain('Do not accept an incoming trade');
    expect(requests.every((request) => request.threadId === 'thread-1')).toBe(true);
  });
});
