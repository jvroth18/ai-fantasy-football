import { afterEach, describe, expect, it } from 'vitest';

import { defaultScheduleSpecs, defineManagementJobs } from './defaults.js';
import { LocalTeamScheduler } from './scheduler.js';
import { schedulerFixture, teamFixture } from './test-fixtures.js';
import type { JobHandler, ManagementJobType } from './types.js';

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const callback of cleanup.splice(0)) callback();
});

describe('local team scheduler', () => {
  it('includes an explicit daily management schedule and bounded game-window checks', () => {
    expect(defaultScheduleSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobType: 'daily_manager', cron: '0 7 * * *' }),
        expect.objectContaining({ jobType: 'lineup_watch', catchUpAfterMinutes: null }),
      ]),
    );
  });

  it('creates timezone-aware entries independently for every team', async () => {
    const { handle, teams, runner } = schedulerFixture();
    cleanup.push(handle.close);
    const east = teams.create(teamFixture('1'));
    const west = teams.create({
      ...teamFixture('2'),
      timeZone: 'America/Los_Angeles',
    });
    const handler: JobHandler = async () => ({ status: 'verified' });
    const handlers = Object.fromEntries(
      defaultScheduleSpecs.map((spec) => [spec.jobType, handler]),
    ) as Record<ManagementJobType, JobHandler>;
    const scheduler = new LocalTeamScheduler(teams, runner, defineManagementJobs(handlers));
    cleanup.push(() => scheduler.stop());

    await scheduler.start(false);
    const entries = scheduler.entries();

    expect(entries).toHaveLength(defaultScheduleSpecs.length * 2);
    expect(entries.filter((entry) => entry.teamId === east.id)).toHaveLength(
      defaultScheduleSpecs.length,
    );
    expect(entries.find((entry) => entry.teamId === west.id)?.timeZone).toBe('America/Los_Angeles');
    expect(entries.every((entry) => entry.nextRun !== null)).toBe(true);

    const triggered = await scheduler.trigger(east.id, 'daily_manager');
    expect(triggered).toMatchObject({
      teamId: east.id,
      jobType: 'daily_manager',
      status: 'verified',
    });
  });
});
