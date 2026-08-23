import { z } from 'zod';

export const isoDateTimeSchema = z.string().datetime();
export const entityIdSchema = z.string().uuid();
export const seasonSchema = z.number().int().min(2000).max(2100);
export const platformSchema = z.enum(['espn']);

export const playerPositionSchema = z.enum([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
  'IDP',
]);

export const rosterSlotTypeSchema = z.enum([
  'QB',
  'RB',
  'WR',
  'TE',
  'FLEX',
  'SUPERFLEX',
  'K',
  'DST',
  'DL',
  'LB',
  'DB',
  'IDP',
  'BENCH',
  'IR',
]);

export const sourceEvidenceSchema = z.object({
  sourceType: z.enum(['upload', 'espn_scan', 'manual', 'provider']),
  sourceName: z.string().min(1),
  sourceDigest: z.string().min(8),
  locator: z.string().min(1).optional(),
  excerpt: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1),
  observedAt: isoDateTimeSchema,
});

export const scoringBonusSchema = z
  .object({
    threshold: z.number(),
    points: z.number(),
    mode: z.enum(['at_least', 'exactly', 'range']).default('at_least'),
    upperThreshold: z.number().optional(),
  })
  .superRefine((bonus, context) => {
    if (bonus.mode === 'range' && bonus.upperThreshold === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['upperThreshold'],
        message: 'Range bonuses require an upper threshold',
      });
    }
  });

export const scoringRuleSchema = z.object({
  stat: z.string().min(1),
  label: z.string().min(1),
  pointsPerUnit: z.number(),
  unitSize: z.number().positive().default(1),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  bonuses: z.array(scoringBonusSchema).default([]),
  evidence: z.array(sourceEvidenceSchema).default([]),
});

export const rosterSlotSchema = z.object({
  slot: rosterSlotTypeSchema,
  count: z.number().int().min(0).max(30),
  starter: z.boolean(),
  eligiblePositions: z.array(playerPositionSchema).min(1),
});

export const draftSettingsSchema = z
  .object({
    type: z.enum(['snake', 'linear', 'auction']),
    teamCount: z.number().int().min(2).max(32),
    rounds: z.number().int().min(1).max(40),
    secondsPerPick: z.number().int().min(10).max(900).nullable(),
    auctionBudget: z.number().int().positive().nullable(),
  })
  .superRefine((draft, context) => {
    if (draft.type === 'auction' && draft.auctionBudget === null) {
      context.addIssue({
        code: 'custom',
        path: ['auctionBudget'],
        message: 'Auction drafts require a budget',
      });
    }
  });

export const waiverSettingsSchema = z.object({
  type: z.enum(['rolling', 'reverse_standings', 'faab', 'continuous_faab']),
  budget: z.number().int().min(0).nullable(),
  minimumBid: z.number().int().min(0).default(0),
  processingDays: z.array(z.number().int().min(0).max(6)).default([]),
  processingTimeLocal: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  freeAgentMode: z.enum(['first_come', 'daily_waivers', 'locked']).default('first_come'),
  maxAcquisitionsPerWeek: z.number().int().positive().nullable(),
  tiebreaker: z.enum(['rolling_order', 'reverse_standings', 'bid_timestamp', 'none']),
});

export const lineupSettingsSchema = z.object({
  lockType: z.enum(['player_game_time', 'first_game', 'weekly']),
  allowBenchEditsAfterLock: z.boolean().default(true),
});

export const playoffSettingsSchema = z.object({
  teams: z.number().int().min(2).max(16),
  startWeek: z.number().int().min(1).max(18),
  championshipWeek: z.number().int().min(1).max(18),
  twoWeekMatchups: z.boolean().default(false),
  reseed: z.boolean().default(false),
});

export const tradeSettingsSchema = z.object({
  deadlineWeek: z.number().int().min(1).max(18).nullable(),
  reviewType: z.enum(['none', 'league_vote', 'commissioner']),
  reviewHours: z.number().int().min(0).max(168),
  futureDraftPicksAllowed: z.boolean().default(false),
});

export const leagueRuleSetV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  name: z.string().min(1).max(120),
  season: seasonSchema,
  platform: platformSchema,
  status: z.enum(['draft', 'active', 'retired']),
  revision: z.number().int().positive(),
  scoring: z.array(scoringRuleSchema).min(1),
  roster: z.array(rosterSlotSchema).min(1),
  draft: draftSettingsSchema,
  waivers: waiverSettingsSchema,
  lineup: lineupSettingsSchema,
  playoffs: playoffSettingsSchema,
  trades: tradeSettingsSchema,
  evidence: z.array(sourceEvidenceSchema).default([]),
  createdAt: isoDateTimeSchema,
});

export const strategyProfileV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  name: z.string().min(1).max(120),
  riskTolerance: z.number().min(0).max(1),
  faabAggressiveness: z.number().min(0).max(1),
  benchChurn: z.number().min(0).max(1),
  preferStacks: z.boolean(),
  preferHandcuffs: z.boolean(),
  positionWeights: z.partialRecord(playerPositionSchema, z.number().min(0).max(5)).default({}),
  protectedPlayerIds: z.array(entityIdSchema).default([]),
  blockedPlayerIds: z.array(entityIdSchema).default([]),
  targetPlayerIds: z.array(entityIdSchema).default([]),
  maximumTradeOffersPerOpponentPerWeek: z.number().int().min(0).max(10).default(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const automationPolicySchema = z.object({
  armed: z.boolean().default(false),
  lineupChanges: z.boolean().default(false),
  waiverClaims: z.boolean().default(false),
  freeAgentMoves: z.boolean().default(false),
  draftPicks: z.boolean().default(false),
  outgoingTradeOffers: z.boolean().default(false),
  incomingTradeAccepts: z.literal(false).default(false),
  maxFaabPerClaim: z.number().int().min(0).nullable(),
  maxFaabPerWeek: z.number().int().min(0).nullable(),
  minimumFaabReserve: z.number().int().min(0).default(0),
  maximumDraftReach: z.number().int().min(0).max(100).default(24),
  minimumDataFreshnessMinutes: z.number().int().positive().default(180),
});

export const teamConfigV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  name: z.string().min(1).max(100),
  platform: platformSchema,
  season: seasonSchema,
  timeZone: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  espnLeagueId: z.string().min(1),
  espnTeamId: z.string().min(1),
  activeRuleSetId: entityIdSchema.nullable(),
  strategyProfileId: entityIdSchema.nullable(),
  automation: automationPolicySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const playerIdentityV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  fullName: z.string().min(1),
  position: playerPositionSchema,
  nflTeam: z.string().min(2).max(3).nullable(),
  espnId: z.string().nullable(),
  sleeperId: z.string().nullable(),
  gsisId: z.string().nullable(),
  mappingConfidence: z.number().min(0).max(1),
  manuallyVerified: z.boolean().default(false),
  updatedAt: isoDateTimeSchema,
});

export const projectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: entityIdSchema,
    teamId: entityIdSchema,
    playerId: entityIdSchema,
    season: seasonSchema,
    week: z.number().int().min(1).max(18).nullable(),
    horizon: z.enum(['weekly', 'rest_of_season']),
    p10: z.number(),
    p50: z.number(),
    p90: z.number(),
    replacementValue: z.number(),
    modelVersion: z.string().min(1),
    generatedAt: isoDateTimeSchema,
    sourceSnapshotIds: z.array(entityIdSchema).default([]),
  })
  .refine((projection) => projection.p10 <= projection.p50 && projection.p50 <= projection.p90, {
    message: 'Projection percentiles must be ordered p10 <= p50 <= p90',
  });

export const recommendationV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  type: z.enum(['draft', 'lineup', 'waiver', 'drop', 'trade']),
  title: z.string().min(1),
  rationale: z.string().min(1),
  projectedPointDelta: z.number().nullable(),
  projectedWinProbabilityDelta: z.number().min(-1).max(1).nullable(),
  risk: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(sourceEvidenceSchema).min(1),
  alternativeIds: z.array(entityIdSchema).default([]),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

export const actionIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  recommendationId: entityIdSchema.nullable(),
  type: z.enum(['lineup_change', 'waiver_claim', 'free_agent_move', 'draft_pick', 'trade_offer']),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(16),
  status: z.enum([
    'proposed',
    'policy_approved',
    'executing',
    'verified',
    'failed',
    'needs_attention',
    'cancelled',
    'superseded',
  ]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const automationRunV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  jobType: z.string().min(1),
  actionIntentId: entityIdSchema.nullable(),
  status: z.enum([
    'queued',
    'executing',
    'verified',
    'failed',
    'needs_attention',
    'cancelled',
    'superseded',
  ]),
  attempt: z.number().int().positive(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  scheduledFor: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});

export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type ScoringRule = z.infer<typeof scoringRuleSchema>;
export type LeagueRuleSetV1 = z.infer<typeof leagueRuleSetV1Schema>;
export type StrategyProfileV1 = z.infer<typeof strategyProfileV1Schema>;
export type AutomationPolicy = z.infer<typeof automationPolicySchema>;
export type TeamConfigV1 = z.infer<typeof teamConfigV1Schema>;
export type PlayerIdentityV1 = z.infer<typeof playerIdentityV1Schema>;
export type ProjectionV1 = z.infer<typeof projectionV1Schema>;
export type RecommendationV1 = z.infer<typeof recommendationV1Schema>;
export type ActionIntentV1 = z.infer<typeof actionIntentV1Schema>;
export type AutomationRunV1 = z.infer<typeof automationRunV1Schema>;
