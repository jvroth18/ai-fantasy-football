import { describe, expect, it } from 'vitest';

import { EspnActionExecutor } from './executor.js';
import {
  contextFixture,
  fixtureNow,
  intentFixture,
  snapshotFixture,
  teamFixture,
} from './test-fixtures.js';
import { InMemoryActionLedger } from './ledger.js';
import { SimulatedEspnPortal } from './simulator.js';

function executorFixture() {
  const portal = new SimulatedEspnPortal(snapshotFixture(), () => fixtureNow);
  const executor = new EspnActionExecutor(portal, new InMemoryActionLedger());
  return { portal, executor };
}

describe('ESPN action executor', () => {
  it('uses read-act-read-back and verifies an exact lineup change', async () => {
    const team = teamFixture();
    const intent = intentFixture(team.id);
    const { portal, executor } = executorFixture();

    const result = await executor.execute(contextFixture(team, intent));

    expect(result.outcome).toBe('verified');
    expect(result.intent.status).toBe('verified');
    expect(result.beforeDigest).toHaveLength(64);
    expect(result.afterDigest).toHaveLength(64);
    expect(result.beforeDigest).not.toBe(result.afterDigest);
    expect(portal.observeCalls).toBe(2);
    expect(portal.performCalls).toBe(1);
  });

  it('replays a completed idempotency key without another portal action', async () => {
    const team = teamFixture();
    const intent = intentFixture(team.id);
    const { portal, executor } = executorFixture();
    const context = contextFixture(team, intent);

    const first = await executor.execute(context);
    const replay = await executor.execute(context);

    expect(first.outcome).toBe('verified');
    expect(replay).toMatchObject({ outcome: 'verified', replayed: true, performed: false });
    expect(portal.performCalls).toBe(1);
    expect(portal.observeCalls).toBe(2);
  });

  it('stops before acting when the visible ESPN team does not match', async () => {
    const team = teamFixture();
    const intent = intentFixture(team.id);
    const { portal, executor } = executorFixture();
    portal.setBinding('league-1', 'team-other');

    const result = await executor.execute(contextFixture(team, intent));

    expect(result).toMatchObject({
      outcome: 'needs_attention',
      performed: false,
      errorCode: 'PORTAL_PRECONDITION_FAILED',
    });
    expect(portal.performCalls).toBe(0);
  });

  it('does not retry an ambiguous submission that cannot be verified', async () => {
    const team = teamFixture();
    const intent = intentFixture(team.id, 'waiver_claim', {
      addPlayerId: 'free-wr',
      dropPlayerId: 'starter-rb',
      bid: 7,
    });
    const { portal, executor } = executorFixture();
    portal.queueOutcome({ status: 'ambiguous', apply: false });

    const result = await executor.execute(contextFixture(team, intent));

    expect(result).toMatchObject({
      outcome: 'needs_attention',
      performed: true,
      errorCode: 'VERIFICATION_FAILED',
    });
    expect(portal.performCalls).toBe(1);
    expect(portal.observeCalls).toBe(2);
  });

  it('trusts state read-back over an ambiguous browser response', async () => {
    const team = teamFixture();
    const intent = intentFixture(team.id, 'waiver_claim', {
      addPlayerId: 'free-wr',
      dropPlayerId: 'starter-rb',
      bid: 7,
    });
    const { portal, executor } = executorFixture();
    portal.queueOutcome({ status: 'ambiguous', apply: true });

    const result = await executor.execute(contextFixture(team, intent));

    expect(result.outcome).toBe('verified');
    expect(portal.performCalls).toBe(1);
  });

  it.each([
    {
      type: 'free_agent_move' as const,
      payload: { addPlayerId: 'free-wr', dropPlayerId: 'starter-rb', targetSlot: 'BENCH' },
    },
    { type: 'draft_pick' as const, payload: { playerId: 'rookie-wr' } },
    {
      type: 'trade_offer' as const,
      payload: {
        opponentTeamId: 'team-3',
        sendPlayerIds: ['starter-rb'],
        receivePlayerIds: ['opponent-wr'],
      },
    },
  ])('verifies the simulated $type path', async ({ type, payload }) => {
    const team = teamFixture();
    const intent = intentFixture(team.id, type, payload);
    const { executor } = executorFixture();

    const result = await executor.execute(contextFixture(team, intent));

    expect(result.outcome).toBe('verified');
  });

  it('never calls the portal when policy denies an action', async () => {
    const configured = teamFixture();
    const team = teamFixture({ automation: { ...configured.automation, armed: false } });
    const intent = intentFixture(team.id);
    const { portal, executor } = executorFixture();

    const result = await executor.execute(contextFixture(team, intent));

    expect(result).toMatchObject({ outcome: 'cancelled', errorCode: 'POLICY_DENIED' });
    expect(portal.observeCalls).toBe(0);
    expect(portal.performCalls).toBe(0);
  });
});
