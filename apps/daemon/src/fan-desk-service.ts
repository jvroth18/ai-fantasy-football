import { randomUUID } from 'node:crypto';

import {
  FanDeskRepository,
  NewsRepository,
  PortalSnapshotRepository,
  type StoredFanEmail,
} from '@ai-ff/db';
import {
  fanDeskProfileV1Schema,
  type FanDeskProfileV1,
  type FanPostV1,
  type TeamConfigV1,
} from '@ai-ff/domain';
import {
  createFanPost,
  type FanDeskContext,
  type FanNewsItem,
  type FanPortalSnapshot,
  type FanVoiceWriter,
} from '@ai-ff/fan-desk';
import { espnPortalSnapshotSchema } from '@ai-ff/espn';
import type { JobHandlerResult } from '@ai-ff/scheduler';

export type FanEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type FanEmailSender = (message: FanEmailMessage) => Promise<{
  sent: boolean;
  provider: string;
  errorMessage?: string;
}>;

export type FanDeskServiceOptions = {
  writer?: FanVoiceWriter;
  syncPortal?: (team: TeamConfigV1) => Promise<unknown>;
  email?: FanEmailSender;
  now?: () => Date;
};

function defaultProfile(team: TeamConfigV1, now: string): FanDeskProfileV1 {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    teamId: team.id,
    name: 'The Stands',
    voice: 'superfan',
    heat: 0.68,
    rumorTolerance: 0.35,
    cadence: 'every_3_hours',
    enabled: true,
    emailEnabled: false,
    emailAddress: null,
    emailSubjectPrefix: `${team.name} // Fan Desk`,
    createdAt: now,
    updatedAt: now,
  };
}

function portalSnapshot(
  record: ReturnType<PortalSnapshotRepository['listRecentForTeam']>[number],
): FanPortalSnapshot {
  const snapshot = espnPortalSnapshotSchema.parse(JSON.parse(record.snapshotJson));
  return {
    id: record.id,
    digest: record.digest,
    observedAt: record.observedAt,
    page: snapshot.page,
    roster: snapshot.roster,
    availablePlayers: snapshot.availablePlayers,
    leagueTeams: snapshot.leagueTeams,
    waiverClaims: snapshot.waiverClaims.map(({ actionId, status }) => ({ actionId, status })),
    tradeOffers: snapshot.tradeOffers.map(({ actionId, status }) => ({ actionId, status })),
    faabRemaining: snapshot.faabRemaining,
  };
}

function newsItem(row: ReturnType<NewsRepository['listRecent']>[number]): FanNewsItem {
  const parsed = JSON.parse(row.newsJson) as {
    title?: string;
    source?: string;
    url?: string;
    publishedAt?: string;
  };
  return {
    title: parsed.title ?? row.title,
    source: parsed.source ?? row.source,
    url: parsed.url ?? row.url,
    publishedAt: parsed.publishedAt ?? row.publishedAt,
  };
}

export class FanDeskService {
  readonly #repository: FanDeskRepository;
  readonly #portalSnapshots: PortalSnapshotRepository;
  readonly #news: NewsRepository;
  readonly #writer: FanVoiceWriter | undefined;
  readonly #syncPortal: ((team: TeamConfigV1) => Promise<unknown>) | undefined;
  readonly #email: FanEmailSender | undefined;
  readonly #now: () => Date;

  constructor(
    database: ConstructorParameters<typeof FanDeskRepository>[0],
    options: FanDeskServiceOptions = {},
  ) {
    this.#repository = new FanDeskRepository(database);
    this.#portalSnapshots = new PortalSnapshotRepository(database);
    this.#news = new NewsRepository(database);
    this.#writer = options.writer;
    this.#syncPortal = options.syncPortal;
    this.#email = options.email;
    this.#now = options.now ?? (() => new Date());
  }

  profile(team: TeamConfigV1): FanDeskProfileV1 {
    return (
      this.#repository.getProfile(team.id) ??
      this.#repository.saveProfile(defaultProfile(team, this.#now().toISOString()))
    );
  }

  saveProfile(
    team: TeamConfigV1,
    input: Omit<FanDeskProfileV1, 'schemaVersion' | 'id' | 'teamId' | 'createdAt' | 'updatedAt'>,
  ): FanDeskProfileV1 {
    const existing = this.#repository.getProfile(team.id);
    const now = this.#now().toISOString();
    return this.#repository.saveProfile(
      fanDeskProfileV1Schema.parse({
        schemaVersion: 1,
        id: existing?.id ?? randomUUID(),
        teamId: team.id,
        ...input,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }),
    );
  }

  posts(teamId: string): FanPostV1[] {
    return this.#repository.listPosts(teamId);
  }

  emails(teamId: string): StoredFanEmail[] {
    return this.#repository.listEmails(teamId);
  }

  async generate(
    team: TeamConfigV1,
  ): Promise<{ post: FanPostV1; email: StoredFanEmail | null; syncWarning: string | null }> {
    const profile = this.profile(team);
    if (!profile.enabled) throw new Error('FAN_DESK_DISABLED');
    let syncWarning: string | null = null;
    if (this.#syncPortal) {
      try {
        await this.#syncPortal(team);
      } catch (error) {
        syncWarning = error instanceof Error ? error.message : String(error);
      }
    }
    const snapshots = this.#portalSnapshots.listRecentForTeam(team.id, 2).map(portalSnapshot);
    const context: FanDeskContext = {
      team,
      profile,
      latest: snapshots[0] ?? null,
      previous: snapshots[1] ?? null,
      news: this.#news.listRecent(20).map(newsItem),
      now: this.#now(),
    };
    let post = await createFanPost(context, this.#writer);
    this.#repository.savePost(post);
    let email: StoredFanEmail | null = null;
    if (profile.emailEnabled && profile.emailAddress) {
      email = this.#repository.queueEmail({
        teamId: team.id,
        postId: post.id,
        recipient: profile.emailAddress,
        subject: `${profile.emailSubjectPrefix}: ${post.headline}`,
        body: `${post.dek}\n\n${post.body}\n\nSTANCE: ${post.stance}`,
        status: 'queued',
        provider: 'pending',
        errorMessage: null,
        createdAt: post.createdAt,
        sentAt: null,
      });
      const delivery = this.#email
        ? await this.#email({ to: email.recipient, subject: email.subject, text: email.body })
        : {
            sent: false,
            provider: 'not_configured',
            errorMessage: 'Configure AI_FF_RESEND_API_KEY and AI_FF_EMAIL_FROM',
          };
      if (delivery.sent) {
        const emailedAt = this.#now().toISOString();
        this.#repository.updateEmail(email.id, 'sent', null, emailedAt);
        this.#repository.markEmailed(post.id, emailedAt);
        post = { ...post, status: 'emailed', emailedAt };
        email = { ...email, status: 'sent', provider: delivery.provider, sentAt: emailedAt };
      } else {
        this.#repository.updateEmail(
          email.id,
          'pending_configuration',
          delivery.errorMessage ?? null,
          null,
        );
        email = {
          ...email,
          status: 'pending_configuration',
          provider: delivery.provider,
          errorMessage: delivery.errorMessage ?? null,
        };
      }
    }
    return { post, email, syncWarning };
  }

  async runScheduled(team: TeamConfigV1): Promise<JobHandlerResult> {
    try {
      const result = await this.generate(team);
      const suffix = result.syncWarning ? `; ESPN sync warning: ${result.syncWarning}` : '';
      return {
        status: 'verified',
        message: `Published ${result.post.kind} fan bulletin${result.email ? `; email ${result.email.status}` : ''}${suffix}`,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'FAN_DESK_DISABLED') {
        return { status: 'verified', message: 'Fan desk disabled by team profile' };
      }
      return {
        status: 'needs_attention',
        errorCode: 'FAN_DESK_GENERATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function resendEmailSender(
  options: { apiKey?: string; from?: string; fetchImpl?: typeof fetch } = {},
): FanEmailSender {
  const apiKey = options.apiKey ?? process.env.AI_FF_RESEND_API_KEY;
  const from = options.from ?? process.env.AI_FF_EMAIL_FROM;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (message) => {
    if (!apiKey || !from)
      return {
        sent: false,
        provider: 'not_configured',
        errorMessage: 'Configure AI_FF_RESEND_API_KEY and AI_FF_EMAIL_FROM',
      };
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    if (!response.ok)
      return {
        sent: false,
        provider: 'resend',
        errorMessage: `Resend rejected the email (${response.status})`,
      };
    return { sent: true, provider: 'resend' };
  };
}
