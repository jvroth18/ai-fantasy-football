import { randomUUID } from 'node:crypto';

import {
  fanDeskProfileV1Schema,
  fanPostV1Schema,
  type FanDeskProfileV1,
  type FanPostV1,
} from '@ai-ff/domain';
import { and, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { fanDeskProfiles, fanEmailOutbox, fanPosts } from './schema.js';

export type StoredFanEmail = typeof fanEmailOutbox.$inferSelect;

export class FanDeskRepository {
  constructor(private readonly db: AppDatabase) {}

  saveProfile(input: FanDeskProfileV1): FanDeskProfileV1 {
    const profile = fanDeskProfileV1Schema.parse(input);
    const existing = this.db
      .select({ teamId: fanDeskProfiles.teamId })
      .from(fanDeskProfiles)
      .where(eq(fanDeskProfiles.id, profile.id))
      .get();
    if (existing && existing.teamId !== profile.teamId) throw new Error('Fan desk profile belongs to a different team');
    this.db
      .insert(fanDeskProfiles)
      .values({ id: profile.id, teamId: profile.teamId, profileJson: JSON.stringify(profile), createdAt: profile.createdAt, updatedAt: profile.updatedAt })
      .onConflictDoUpdate({ target: fanDeskProfiles.teamId, set: { profileJson: JSON.stringify(profile), updatedAt: profile.updatedAt } })
      .run();
    return profile;
  }

  getProfile(teamId: string): FanDeskProfileV1 | null {
    const row = this.db.select().from(fanDeskProfiles).where(eq(fanDeskProfiles.teamId, teamId)).get();
    return row ? fanDeskProfileV1Schema.parse(JSON.parse(row.profileJson)) : null;
  }

  savePost(input: FanPostV1): FanPostV1 {
    const post = fanPostV1Schema.parse(input);
    const profile = this.db
      .select({ teamId: fanDeskProfiles.teamId })
      .from(fanDeskProfiles)
      .where(and(eq(fanDeskProfiles.id, post.profileId), eq(fanDeskProfiles.teamId, post.teamId)))
      .get();
    if (!profile) throw new Error('Fan desk post profile does not belong to team');
    this.db.insert(fanPosts).values({ id: post.id, teamId: post.teamId, profileId: post.profileId, kind: post.kind, status: post.status, postJson: JSON.stringify(post), createdAt: post.createdAt, emailedAt: post.emailedAt }).run();
    return post;
  }

  markEmailed(postId: string, emailedAt: string): void {
    const row = this.db.select().from(fanPosts).where(eq(fanPosts.id, postId)).get();
    if (!row) throw new Error('Fan post not found');
    const post = fanPostV1Schema.parse(JSON.parse(row.postJson));
    const updated = fanPostV1Schema.parse({ ...post, status: 'emailed', emailedAt });
    this.db.update(fanPosts).set({ status: 'emailed', postJson: JSON.stringify(updated), emailedAt }).where(eq(fanPosts.id, postId)).run();
  }

  listPosts(teamId: string, limit = 20): FanPostV1[] {
    return this.db.select().from(fanPosts).where(eq(fanPosts.teamId, teamId)).orderBy(desc(fanPosts.createdAt)).limit(Math.min(limit, 100)).all().map((row) => fanPostV1Schema.parse(JSON.parse(row.postJson)));
  }

  queueEmail(input: Omit<typeof fanEmailOutbox.$inferInsert, 'id'> & { id?: string }): StoredFanEmail {
    const id = input.id ?? randomUUID();
    this.db.insert(fanEmailOutbox).values({ ...input, id }).run();
    const row = this.db.select().from(fanEmailOutbox).where(eq(fanEmailOutbox.id, id)).get();
    if (!row) throw new Error('Fan email disappeared after insert');
    return row;
  }

  updateEmail(id: string, status: string, errorMessage: string | null, sentAt: string | null): void {
    this.db.update(fanEmailOutbox).set({ status, errorMessage, sentAt }).where(eq(fanEmailOutbox.id, id)).run();
  }

  listEmails(teamId: string, limit = 20): StoredFanEmail[] {
    return this.db.select().from(fanEmailOutbox).where(eq(fanEmailOutbox.teamId, teamId)).orderBy(desc(fanEmailOutbox.createdAt)).limit(Math.min(limit, 100)).all();
  }
}
