import type { JobDefinition, JobHandler, ManagementJobType, ScheduleSpec } from './types.js';

export const defaultScheduleSpecs: readonly ScheduleSpec[] = [
  {
    jobType: 'news_refresh',
    description: 'Refresh configured news feeds and attach player alerts',
    cron: '17 * * * *',
    leaseMinutes: 15,
    catchUpAfterMinutes: 90,
  },
  {
    jobType: 'data_refresh',
    description: 'Refresh public player, trend, roster, injury, and projection inputs',
    cron: '15 6 * * *',
    leaseMinutes: 45,
    catchUpAfterMinutes: 1_500,
  },
  {
    jobType: 'daily_manager',
    description: 'Recompute action-oriented team recommendations',
    cron: '0 7 * * *',
    leaseMinutes: 45,
    catchUpAfterMinutes: 1_500,
  },
  {
    jobType: 'waiver_plan',
    description: 'Prepare waiver priorities before common Tuesday processing windows',
    cron: '0 18 * * 2',
    leaseMinutes: 30,
    catchUpAfterMinutes: 10_080,
  },
  {
    jobType: 'trade_market',
    description: 'Search for fair outgoing trade proposals once per week',
    cron: '0 12 * * 3',
    leaseMinutes: 30,
    catchUpAfterMinutes: 10_080,
  },
  {
    jobType: 'lineup_watch',
    description: 'Recheck lineup news near the main NFL game windows',
    cron: '*/30 8-20 * * 0,1,4',
    leaseMinutes: 20,
    catchUpAfterMinutes: null,
  },
  {
    jobType: 'fan_digest',
    description: 'Review observed league activity and publish a fan desk bulletin',
    cron: '0 */3 * * *',
    leaseMinutes: 20,
    catchUpAfterMinutes: 480,
  },
] as const;

export function defineManagementJobs(
  handlers: Record<ManagementJobType, JobHandler>,
): JobDefinition[] {
  return defaultScheduleSpecs.map((spec) => ({ ...spec, handler: handlers[spec.jobType] }));
}
