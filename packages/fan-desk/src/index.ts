import { createHash, randomUUID } from 'node:crypto';

import type {
  FanDeskProfileV1,
  FanPostKind,
  FanPostV1,
  FanVoice,
  SourceEvidence,
  TeamConfigV1,
} from '@ai-ff/domain';

export type FanPortalRosterEntry = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  availability: string;
  slot?: string;
};

export type FanPortalSnapshot = {
  id: string;
  digest: string;
  observedAt: string;
  page: string;
  roster: FanPortalRosterEntry[];
  availablePlayers: Array<FanPortalRosterEntry & { acquisitionType: string; rosteredPercent: number | null }>;
  leagueTeams: Array<{ teamId: string; name: string; roster: FanPortalRosterEntry[] }>;
  waiverClaims: Array<{ actionId: string; status: string }>;
  tradeOffers: Array<{ actionId: string; status: string }>;
  faabRemaining: number | null;
};

export type FanNewsItem = {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
};

export type FanDeskContext = {
  team: TeamConfigV1;
  profile: FanDeskProfileV1;
  latest: FanPortalSnapshot | null;
  previous: FanPortalSnapshot | null;
  news: FanNewsItem[];
  now: Date;
};

export type FanPostDraft = Pick<
  FanPostV1,
  'kind' | 'headline' | 'dek' | 'body' | 'stance' | 'heat' | 'evidence'
> & { generatedBy: FanPostV1['generatedBy'] };

export type FanVoiceWriter = (input: {
  profile: FanDeskProfileV1;
  team: TeamConfigV1;
  seed: FanPostDraft;
  context: FanDeskContext;
}) => Promise<Pick<FanPostDraft, 'headline' | 'dek' | 'body' | 'stance'>>;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function evidence(
  sourceType: SourceEvidence['sourceType'],
  sourceName: string,
  sourceDigest: string,
  observedAt: string,
  excerpt: string,
  locator?: string,
): SourceEvidence {
  return {
    sourceType,
    sourceName,
    sourceDigest: sourceDigest.length >= 8 ? sourceDigest : digest(sourceDigest),
    observedAt,
    confidence: sourceType === 'espn_scan' ? 0.98 : 0.82,
    excerpt: excerpt.slice(0, 500),
    ...(locator ? { locator } : {}),
  };
}

function rosterDelta(latest: FanPortalSnapshot | null, previous: FanPortalSnapshot | null) {
  if (!latest || !previous) return { added: [], dropped: [] };
  const before = new Map(previous.roster.map((player) => [player.playerId, player]));
  const after = new Map(latest.roster.map((player) => [player.playerId, player]));
  return {
    added: latest.roster.filter((player) => !before.has(player.playerId)),
    dropped: previous.roster.filter((player) => !after.has(player.playerId)),
  };
}

function selectKind(context: FanDeskContext, added: number, dropped: number): FanPostKind {
  const newestNews = context.news[0];
  if (newestNews && Date.parse(newestNews.publishedAt) >= context.now.getTime() - 36 * 60 * 60_000) {
    return 'breaking_news';
  }
  if (context.latest?.waiverClaims.length || context.latest?.availablePlayers.length) {
    return 'waiver_wire';
  }
  if (context.latest?.tradeOffers.length || added + dropped >= 2) return 'trade_rumor';
  if (context.latest?.leagueTeams.length && context.latest.leagueTeams.length > 2) {
    return context.profile.cadence === 'weekly' ? 'weekly_recap' : 'power_rankings';
  }
  return 'game_thread';
}

function voiceLead(voice: FanVoice): string {
  const leads: Record<FanVoice, string> = {
    superfan: 'The stands are shaking',
    contrarian: 'I am going to say the quiet part out loud',
    analyst: 'The tape is giving us a clear signal',
    commissioner: 'Official league bulletin',
  };
  return leads[voice] ?? leads.analyst;
}

function heatLine(voice: FanVoice, heat: number): string {
  if (voice === 'commissioner') return 'Keep it spicy, keep it inside the lines.';
  if (heat >= 0.75) return 'Someone is going to be extremely normal about this. It will not be me.';
  if (voice === 'contrarian') return 'The group chat will hate this take. That is how we know it is working.';
  return 'No panic. Just receipts.';
}

export function createFanPostDraft(context: FanDeskContext): FanPostDraft {
  const latest = context.latest;
  const delta = rosterDelta(latest, context.previous);
  const kind = selectKind(context, delta.added.length, delta.dropped.length);
  const newestNews = context.news[0];
  const topAvailable = latest?.availablePlayers.slice(0, 3).map((player) => player.name) ?? [];
  const addedNames = delta.added.slice(0, 3).map((player) => player.name);
  const droppedNames = delta.dropped.slice(0, 3).map((player) => player.name);
  const signal = latest
    ? `ESPN scan ${latest.observedAt}: ${latest.roster.length} rostered players, ${latest.availablePlayers.length} visible free/waiver options, ${latest.leagueTeams.length} league rosters in view.`
    : 'No ESPN scan is available yet; this is a scene-setter, not a claim about live league state.';
  const newsLine = newestNews ? `The latest headline from ${newestNews.source}: “${newestNews.title}”.` : 'The news cycle is quiet, which usually means the league is about to do something loud.';
  const movement = delta.added.length || delta.dropped.length
    ? `Roster movement: added ${addedNames.join(', ') || 'nobody visible'}; dropped ${droppedNames.join(', ') || 'nobody visible'}.`
    : `The waiver board is flashing ${topAvailable.join(', ') || 'no obvious names'}${topAvailable.length ? ' as the names to watch' : ''}.`;
  const headlines: Record<FanPostKind, string> = {
    breaking_news: `${voiceLead(context.profile.voice)}: the league has a news problem`,
    waiver_wire: `Waiver wire temperature check: ${topAvailable[0] ?? 'the board'} is begging for attention`,
    trade_rumor: `Trade desk: somebody is making a move before they admit it`,
    power_rankings: `Power rankings with receipts: vibes are not a scoring category`,
    game_thread: `Game thread: ${context.team.name} is on the clock`,
    weekly_recap: `The weekly league report: heroes, villains, and one avoidable mistake`,
  };
  const stance = context.profile.voice === 'contrarian'
    ? `The popular take is wrong: ${topAvailable[0] ?? context.team.name} is the pressure point.`
    : context.profile.voice === 'analyst'
      ? `The actionable edge is simple: watch ${topAvailable[0] ?? 'the next verified signal'} before chasing noise.`
      : `${context.team.name} is not waiting for permission to make this interesting.`;
  return {
    kind,
    headline: headlines[kind],
    dek: `${heatLine(context.profile.voice, context.profile.heat)} ${newsLine}`,
    body: [movement, signal, newsLine, heatLine(context.profile.voice, context.profile.heat)].join('\n\n'),
    stance,
    heat: Math.min(1, Math.max(0, context.profile.heat + (context.profile.voice === 'contrarian' ? 0.1 : 0))),
    generatedBy: 'deterministic',
    evidence: [
      ...(latest
        ? [evidence('espn_scan', 'ESPN Computer Use snapshot', latest.digest, latest.observedAt, signal, latest.page)]
        : []),
      ...(newestNews
        ? [evidence('provider', newestNews.source, digest(newestNews.url), newestNews.publishedAt, newestNews.title, newestNews.url)]
        : []),
    ].length
      ? [
          ...(latest
            ? [evidence('espn_scan', 'ESPN Computer Use snapshot', latest.digest, latest.observedAt, signal, latest.page)]
            : []),
          ...(newestNews
            ? [evidence('provider', newestNews.source, digest(newestNews.url), newestNews.publishedAt, newestNews.title, newestNews.url)]
            : []),
        ]
      : [evidence('manual', 'Fan desk scene-setter', digest(context.team.id), context.now.toISOString(), 'Generated without a current portal or news snapshot')],
  };
}

export async function createFanPost(
  context: FanDeskContext,
  writer?: FanVoiceWriter,
): Promise<FanPostV1> {
  const seed = createFanPostDraft(context);
  const written = writer ? await writer({ profile: context.profile, team: context.team, seed, context }) : null;
  const finalDraft = written ? { ...seed, ...written, generatedBy: 'codex' as const } : seed;
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId: context.team.id,
    profileId: context.profile.id,
    status: 'published',
    ...finalDraft,
    createdAt: context.now.toISOString(),
    emailedAt: null,
  };
}
