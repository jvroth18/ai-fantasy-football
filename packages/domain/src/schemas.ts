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

export const recommendationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('lineup_change'),
    payload: z.object({
      playerInId: z.string().min(1),
      playerOutId: z.string().min(1),
      targetSlot: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('waiver_claim'),
    payload: z.object({
      addPlayerId: z.string().min(1),
      dropPlayerId: z.string().min(1).nullable(),
      bid: z.number().int().min(0).nullable(),
    }),
  }),
  z.object({
    type: z.literal('free_agent_move'),
    payload: z.object({
      addPlayerId: z.string().min(1),
      dropPlayerId: z.string().min(1).nullable(),
      targetSlot: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('draft_pick'),
    payload: z.object({ playerId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('trade_offer'),
    payload: z.object({
      opponentTeamId: z.string().min(1),
      sendPlayerIds: z.array(z.string().min(1)).min(1),
      receivePlayerIds: z.array(z.string().min(1)).min(1),
    }),
  }),
]);

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
  action: recommendationActionSchema.nullable(),
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

export const fanVoiceSchema = z.enum(['superfan', 'contrarian', 'analyst', 'commissioner']);
export const fanCadenceSchema = z.enum(['hourly', 'every_3_hours', 'daily', 'weekly']);

export const fanDeskProfileV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  name: z.string().min(1).max(80),
  voice: fanVoiceSchema,
  heat: z.number().min(0).max(1),
  rumorTolerance: z.number().min(0).max(1),
  cadence: fanCadenceSchema,
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  emailAddress: z.string().email().nullable(),
  emailSubjectPrefix: z.string().min(1).max(80),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const fanPostKindSchema = z.enum([
  'breaking_news',
  'waiver_wire',
  'trade_rumor',
  'power_rankings',
  'game_thread',
  'weekly_recap',
]);

export const fanPostStatusSchema = z.enum(['published', 'emailed']);

export const fanPostV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  teamId: entityIdSchema,
  profileId: entityIdSchema,
  kind: fanPostKindSchema,
  status: fanPostStatusSchema,
  headline: z.string().min(1).max(180),
  dek: z.string().min(1).max(240),
  body: z.string().min(1).max(12_000),
  stance: z.string().min(1).max(240),
  heat: z.number().min(0).max(1),
  evidence: z.array(sourceEvidenceSchema).min(1),
  generatedBy: z.enum(['deterministic', 'codex']),
  createdAt: isoDateTimeSchema,
  emailedAt: isoDateTimeSchema.nullable(),
});

export const fanEventTypeSchema = z.enum([
  'espn.snapshot.updated',
  'news.item.created',
  'league.signal.detected',
  'analysis.ready',
  'fan.post.drafted',
  'fan.post.approved',
  'fan.post.published',
  'fan.mention.received',
  'fan.reply.drafted',
  'fan.reply.approved',
  'digest.due',
]);

export const fanAgentRoleSchema = z.enum([
  'observer',
  'analyst',
  'superfan',
  'contrarian',
  'commissioner',
  'publisher',
  'reply_writer',
  'moderator',
  'custom',
]);

export const fanModelConfigSchema = z.object({
  provider: z.enum(['codex', 'openai', 'ollama', 'http', 'none']),
  modelId: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(16_000),
});

export const fanAgentSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/),
  name: z.string().min(1).max(80),
  role: fanAgentRoleSchema,
  instructions: z.string().max(4_000),
  model: fanModelConfigSchema,
  listensTo: z.array(fanEventTypeSchema).min(1),
  emits: z.array(fanEventTypeSchema).default([]),
  enabled: z.boolean(),
  heat: z.number().min(0).max(1),
  toolPermissions: z
    .object({
      readPortal: z.boolean(),
      readNews: z.boolean(),
      publish: z.boolean(),
      reply: z.boolean(),
    })
    .default({ readPortal: true, readNews: true, publish: false, reply: false }),
});

export const fanNetworkPolicySchema = z.object({
  requireEvidence: z.boolean().default(true),
  identifyAsAi: z.boolean().default(true),
  maxRepliesPerHour: z.number().int().min(0).max(10_000).default(20),
  maxModelSpendPerDay: z.number().min(0).max(1_000).default(2),
  maxTurnsPerEvent: z.number().int().min(1).max(20).default(8),
  neverInventInjuries: z.boolean().default(true),
  neverAcceptTrades: z.boolean().default(true),
});

export const fanNetworkRouteSchema = z.object({
  event: fanEventTypeSchema,
  to: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/)).min(1),
  parallel: z.boolean().default(true),
});

export const fanNetworkV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: entityIdSchema,
    teamId: entityIdSchema,
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    agents: z.array(fanAgentSchema).min(1).max(32),
    routes: z.array(fanNetworkRouteSchema).min(1).max(64),
    policies: fanNetworkPolicySchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((network, context) => {
    const ids = new Set<string>();
    for (const [index, agent] of network.agents.entries()) {
      if (ids.has(agent.id)) {
        context.addIssue({
          code: 'custom',
          path: ['agents', index, 'id'],
          message: 'Agent ids must be unique',
        });
      }
      ids.add(agent.id);
    }
    for (const [index, route] of network.routes.entries()) {
      for (const agentId of route.to) {
        if (!ids.has(agentId)) {
          context.addIssue({
            code: 'custom',
            path: ['routes', index, 'to'],
            message: `Route references unknown agent ${agentId}`,
          });
        }
      }
    }
  });

export const fanNetworkEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  networkId: entityIdSchema,
  teamId: entityIdSchema,
  type: fanEventTypeSchema,
  correlationId: entityIdSchema,
  sourceAgentId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  evidence: z.array(sourceEvidenceSchema).default([]),
  createdAt: isoDateTimeSchema,
});

export const fanAgentRunV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: entityIdSchema,
  networkId: entityIdSchema,
  teamId: entityIdSchema,
  eventId: entityIdSchema,
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/),
  status: z.enum(['queued', 'executing', 'completed', 'skipped', 'failed']),
  attempt: z.number().int().positive(),
  outputEventIds: z.array(entityIdSchema),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoDateTimeSchema,
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
export type RecommendationAction = z.infer<typeof recommendationActionSchema>;
export type RecommendationV1 = z.infer<typeof recommendationV1Schema>;
export type ActionIntentV1 = z.infer<typeof actionIntentV1Schema>;
export type AutomationRunV1 = z.infer<typeof automationRunV1Schema>;
export type FanVoice = z.infer<typeof fanVoiceSchema>;
export type FanCadence = z.infer<typeof fanCadenceSchema>;
export type FanDeskProfileV1 = z.infer<typeof fanDeskProfileV1Schema>;
export type FanPostKind = z.infer<typeof fanPostKindSchema>;
export type FanPostV1 = z.infer<typeof fanPostV1Schema>;
export type FanEventType = z.infer<typeof fanEventTypeSchema>;
export type FanAgentRole = z.infer<typeof fanAgentRoleSchema>;
export type FanModelConfig = z.infer<typeof fanModelConfigSchema>;
export type FanAgent = z.infer<typeof fanAgentSchema>;
export type FanNetworkPolicy = z.infer<typeof fanNetworkPolicySchema>;
export type FanNetworkRoute = z.infer<typeof fanNetworkRouteSchema>;
export type FanNetworkV1 = z.infer<typeof fanNetworkV1Schema>;
export type FanNetworkEventV1 = z.infer<typeof fanNetworkEventV1Schema>;
export type FanAgentRunV1 = z.infer<typeof fanAgentRunV1Schema>;
