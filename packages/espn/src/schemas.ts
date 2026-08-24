import { z } from 'zod';

const portalPlayerSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  position: z.string().min(1),
  nflTeam: z.string().nullable(),
});

const availablePlayerSchema = portalPlayerSchema.extend({
  acquisitionType: z.enum(['waiver', 'free_agent', 'unknown']),
});

const rosterEntrySchema = portalPlayerSchema.extend({
  slot: z.string().min(1),
  locked: z.boolean(),
});

const leagueTeamSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1),
  roster: z.array(portalPlayerSchema),
});

const waiverClaimSchema = z.object({
  actionId: z.string().min(1),
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().nullable(),
  bid: z.number().int().min(0).nullable(),
  status: z.enum(['pending', 'processed', 'cancelled']),
});

const tradeOfferSchema = z.object({
  actionId: z.string().min(1),
  opponentTeamId: z.string().min(1),
  sendPlayerIds: z.array(z.string().min(1)).min(1),
  receivePlayerIds: z.array(z.string().min(1)).min(1),
  status: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
});

export const espnPortalSnapshotSchema = z.object({
  signedIn: z.boolean(),
  leagueId: z.string().min(1),
  teamId: z.string().min(1),
  page: z.enum(['clubhouse', 'players', 'draft', 'trades', 'unknown']),
  roster: z.array(rosterEntrySchema),
  availablePlayers: z.array(availablePlayerSchema),
  leagueTeams: z.array(leagueTeamSchema),
  waiverClaims: z.array(waiverClaimSchema),
  tradeOffers: z.array(tradeOfferSchema),
  draft: z.object({
    status: z.enum(['pre_draft', 'live', 'complete']),
    onClockTeamId: z.string().nullable(),
    draftSlot: z.number().int().min(1).max(32).nullable(),
    picks: z.array(
      z.object({
        actionId: z.string().min(1),
        teamId: z.string().min(1),
        playerId: z.string().min(1),
      }),
    ),
  }),
  observedAt: z.string().datetime(),
});

const actionBaseSchema = z.object({ actionId: z.string().uuid() });

export const portalActionSchema = z.discriminatedUnion('type', [
  actionBaseSchema.extend({
    type: z.literal('lineup_change'),
    playerInId: z.string().min(1),
    playerOutId: z.string().min(1),
    targetSlot: z.string().min(1),
  }),
  actionBaseSchema.extend({
    type: z.literal('waiver_claim'),
    addPlayerId: z.string().min(1),
    dropPlayerId: z.string().nullable(),
    bid: z.number().int().min(0).nullable(),
  }),
  actionBaseSchema.extend({
    type: z.literal('free_agent_move'),
    addPlayerId: z.string().min(1),
    dropPlayerId: z.string().nullable(),
    targetSlot: z.string().min(1).default('BENCH'),
  }),
  actionBaseSchema.extend({
    type: z.literal('draft_pick'),
    playerId: z.string().min(1),
  }),
  actionBaseSchema.extend({
    type: z.literal('trade_offer'),
    opponentTeamId: z.string().min(1),
    sendPlayerIds: z.array(z.string().min(1)).min(1),
    receivePlayerIds: z.array(z.string().min(1)).min(1),
  }),
]);

export const portalActionResultSchema = z.object({
  status: z.enum(['submitted', 'rejected', 'ambiguous']),
  evidence: z.array(z.string().min(1)).min(1),
  errorCode: z.string().nullable().default(null),
});

export const portalSnapshotJsonSchema = {
  type: 'object',
  properties: {
    signedIn: { type: 'boolean' },
    leagueId: { type: 'string' },
    teamId: { type: 'string' },
    page: { type: 'string', enum: ['clubhouse', 'players', 'draft', 'trades', 'unknown'] },
    roster: { type: 'array', items: { $ref: '#/$defs/rosterEntry' } },
    availablePlayers: { type: 'array', items: { $ref: '#/$defs/availablePlayer' } },
    leagueTeams: { type: 'array', items: { $ref: '#/$defs/leagueTeam' } },
    waiverClaims: { type: 'array', items: { $ref: '#/$defs/waiverClaim' } },
    tradeOffers: { type: 'array', items: { $ref: '#/$defs/tradeOffer' } },
    draft: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pre_draft', 'live', 'complete'] },
        onClockTeamId: { type: ['string', 'null'] },
        draftSlot: { type: ['number', 'null'] },
        picks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              actionId: { type: 'string' },
              teamId: { type: 'string' },
              playerId: { type: 'string' },
            },
            required: ['actionId', 'teamId', 'playerId'],
            additionalProperties: false,
          },
        },
      },
      required: ['status', 'onClockTeamId', 'draftSlot', 'picks'],
      additionalProperties: false,
    },
    observedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'signedIn',
    'leagueId',
    'teamId',
    'page',
    'roster',
    'availablePlayers',
    'leagueTeams',
    'waiverClaims',
    'tradeOffers',
    'draft',
    'observedAt',
  ],
  additionalProperties: false,
  $defs: {
    player: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        name: { type: 'string' },
        position: { type: 'string' },
        nflTeam: { type: ['string', 'null'] },
      },
      required: ['playerId', 'name', 'position', 'nflTeam'],
      additionalProperties: false,
    },
    availablePlayer: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        name: { type: 'string' },
        position: { type: 'string' },
        nflTeam: { type: ['string', 'null'] },
        acquisitionType: {
          type: 'string',
          enum: ['waiver', 'free_agent', 'unknown'],
        },
      },
      required: ['playerId', 'name', 'position', 'nflTeam', 'acquisitionType'],
      additionalProperties: false,
    },
    leagueTeam: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        name: { type: 'string' },
        roster: { type: 'array', items: { $ref: '#/$defs/player' } },
      },
      required: ['teamId', 'name', 'roster'],
      additionalProperties: false,
    },
    rosterEntry: {
      type: 'object',
      properties: {
        playerId: { type: 'string' },
        name: { type: 'string' },
        position: { type: 'string' },
        nflTeam: { type: ['string', 'null'] },
        slot: { type: 'string' },
        locked: { type: 'boolean' },
      },
      required: ['playerId', 'name', 'position', 'nflTeam', 'slot', 'locked'],
      additionalProperties: false,
    },
    waiverClaim: {
      type: 'object',
      properties: {
        actionId: { type: 'string' },
        addPlayerId: { type: 'string' },
        dropPlayerId: { type: ['string', 'null'] },
        bid: { type: ['number', 'null'] },
        status: { type: 'string', enum: ['pending', 'processed', 'cancelled'] },
      },
      required: ['actionId', 'addPlayerId', 'dropPlayerId', 'bid', 'status'],
      additionalProperties: false,
    },
    tradeOffer: {
      type: 'object',
      properties: {
        actionId: { type: 'string' },
        opponentTeamId: { type: 'string' },
        sendPlayerIds: { type: 'array', items: { type: 'string' } },
        receivePlayerIds: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['pending', 'accepted', 'declined', 'cancelled'] },
      },
      required: ['actionId', 'opponentTeamId', 'sendPlayerIds', 'receivePlayerIds', 'status'],
      additionalProperties: false,
    },
  },
} as const;

export const portalActionResultJsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['submitted', 'rejected', 'ambiguous'] },
    evidence: { type: 'array', items: { type: 'string' } },
    errorCode: { type: ['string', 'null'] },
  },
  required: ['status', 'evidence', 'errorCode'],
  additionalProperties: false,
} as const;

export type EspnPortalSnapshot = z.infer<typeof espnPortalSnapshotSchema>;
export type PortalAction = z.infer<typeof portalActionSchema>;
export type PortalActionResult = z.infer<typeof portalActionResultSchema>;
