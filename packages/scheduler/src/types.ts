import type { AutomationRunV1, TeamConfigV1 } from '@ai-ff/domain';

export type ManagementJobType =
  | 'news_refresh'
  | 'data_refresh'
  | 'daily_manager'
  | 'waiver_plan'
  | 'trade_market'
  | 'lineup_watch'
  | 'fan_digest';

export type ScheduleSpec = {
  jobType: ManagementJobType;
  description: string;
  cron: string;
  leaseMinutes: number;
  catchUpAfterMinutes: number | null;
};

export type JobHandlerContext = {
  team: TeamConfigV1;
  runId: string;
  scheduledFor: string;
  catchUp: boolean;
};

export type JobHandlerResult = {
  status: 'verified' | 'needs_attention';
  errorCode?: string | null;
  message?: string | null;
};

export type JobHandler = (context: JobHandlerContext) => Promise<JobHandlerResult>;

export type JobDefinition = ScheduleSpec & {
  handler: JobHandler;
};

export type SchedulerEntry = {
  teamId: string;
  teamName: string;
  timeZone: string;
  jobType: ManagementJobType;
  cron: string;
  nextRun: string | null;
};

export type RunResult = AutomationRunV1 | null;
