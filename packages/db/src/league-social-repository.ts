import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { leagueMembers, leaguePosts } from './schema.js';

export type LeagueMember = typeof leagueMembers.$inferSelect;
export type LeaguePost = typeof leaguePosts.$inferSelect & { authorName: string };

export class LeagueSocialRepository {
  constructor(private readonly db: AppDatabase) {}

  addMember(
    teamId: string,
    displayName: string,
    role: 'owner' | 'member',
    joinedAt: string,
  ): LeagueMember {
    const member = { id: randomUUID(), teamId, displayName, role, joinedAt };
    this.db.insert(leagueMembers).values(member).run();
    return member;
  }

  listMembers(teamId: string): LeagueMember[] {
    return this.db.select().from(leagueMembers).where(eq(leagueMembers.teamId, teamId)).all();
  }

  addPost(teamId: string, memberId: string, body: string, createdAt: string): LeaguePost {
    const member = this.db
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.teamId, teamId)))
      .get();
    if (!member) throw new Error('League member not found');
    const post = { id: randomUUID(), teamId, memberId, body, createdAt };
    this.db.insert(leaguePosts).values(post).run();
    return { ...post, authorName: member.displayName };
  }

  listPosts(teamId: string, limit = 100): LeaguePost[] {
    return this.db
      .select({
        id: leaguePosts.id,
        teamId: leaguePosts.teamId,
        memberId: leaguePosts.memberId,
        body: leaguePosts.body,
        createdAt: leaguePosts.createdAt,
        authorName: leagueMembers.displayName,
      })
      .from(leaguePosts)
      .innerJoin(leagueMembers, eq(leaguePosts.memberId, leagueMembers.id))
      .where(eq(leaguePosts.teamId, teamId))
      .orderBy(desc(leaguePosts.createdAt))
      .limit(limit)
      .all();
  }
}
