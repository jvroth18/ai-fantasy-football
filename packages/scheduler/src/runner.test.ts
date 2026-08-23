import { afterEach, describe, expect, it, vi } from 'vitest';

import { definitionFixture, schedulerFixture, schedulerNow, teamFixture } from './test-fixtures.js';

const closeCallbacks: Array<() => void> = [];

afterEach(() => {
  for (const close of closeCallbacks.splice(0)) close();
});

describe('durable job runner', () => {
  it('records queued, executing, and verified completion without overlap', async () => {
    const { handle, teams, runs, runner } = schedulerFixture();
    closeCallbacks.push(handle.close);
    const team = teams.create(teamFixture());
    let finish: (() => void) | undefined;
    const handler = vi.fn(
      async () =>
        await new Promise<{ status: 'verified' }>((resolve) => {
          finish = () => resolve({ status: 'verified' });
        }),
    );
    const definition = definitionFixture({ handler });

    const first = runner.run(team, definition);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    const overlapping = await runner.run(team, definition);
    expect(overlapping).toBeNull();
    finish?.();
    const completed = await first;

    expect(completed).toMatchObject({ status: 'verified', teamId: team.id, attempt: 1 });
    expect(runs.listRecent(team.id)).toEqual([completed]);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('captures bounded handler failures instead of crashing the scheduler', async () => {
    const { handle, teams, runner } = schedulerFixture();
    closeCallbacks.push(handle.close);
    const team = teams.create(teamFixture());
    const result = await runner.run(
      team,
      definitionFixture({
        handler: async () => {
          throw new Error('provider unavailable');
        },
      }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'JOB_HANDLER_FAILED',
      errorMessage: 'provider unavailable',
    });
  });

  it('runs one catch-up per due job and team while skipping disabled catch-up specs', async () => {
    const { handle, teams, runner } = schedulerFixture();
    closeCallbacks.push(handle.close);
    const teamA = teams.create(teamFixture('1'));
    const teamB = teams.create(teamFixture('2'));
    const calls: Array<{ teamId: string; catchUp: boolean }> = [];
    const due = definitionFixture({
      handler: async (context) => {
        calls.push({ teamId: context.team.id, catchUp: context.catchUp });
        return { status: 'verified' };
      },
    });
    const noCatchUp = definitionFixture({
      jobType: 'lineup_watch',
      catchUpAfterMinutes: null,
      handler: async () => ({ status: 'verified' }),
    });

    const results = await runner.runDueCatchUps([teamA, teamB], [due, noCatchUp]);

    expect(results).toHaveLength(2);
    expect(calls).toEqual([
      { teamId: teamA.id, catchUp: true },
      { teamId: teamB.id, catchUp: true },
    ]);
    expect(results.every((result) => result?.scheduledFor === schedulerNow)).toBe(true);
  });
});
