import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { leagueComments, leagueMembers, leaguePosts, leagueReactions } from './schema.js';

export type LeagueMember = typeof leagueMembers.$inferSelect;
export type LeaguePost = typeof leaguePosts.$inferSelect & { authorName: string };
export type LeagueTargetType = 'member_post' | 'ai_post' | 'news';
export type LeagueReaction = typeof leagueReactions.$inferSelect;
export type LeagueComment = typeof leagueComments.$inferSelect & { authorName: string };

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
    const member = this.requireMember(teamId, memberId);
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

  toggleReaction(
    teamId: string,
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
    createdAt: string,
  ): { active: boolean } {
    this.requireMember(teamId, memberId);
    const where = and(
      eq(leagueReactions.teamId, teamId),
      eq(leagueReactions.memberId, memberId),
      eq(leagueReactions.targetType, targetType),
      eq(leagueReactions.targetId, targetId),
    );
    if (this.db.select().from(leagueReactions).where(where).get()) {
      this.db.delete(leagueReactions).where(where).run();
      return { active: false };
    }
    this.db
      .insert(leagueReactions)
      .values({ id: randomUUID(), teamId, memberId, targetType, targetId, createdAt })
      .run();
    return { active: true };
  }

  listReactions(teamId: string): LeagueReaction[] {
    return this.db.select().from(leagueReactions).where(eq(leagueReactions.teamId, teamId)).all();
  }

  addComment(
    teamId: string,
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
    body: string,
    createdAt: string,
  ): LeagueComment {
    const member = this.requireMember(teamId, memberId);
    const comment = { id: randomUUID(), teamId, memberId, targetType, targetId, body, createdAt };
    this.db.insert(leagueComments).values(comment).run();
    return { ...comment, authorName: member.displayName };
  }

  listComments(teamId: string, limit = 300): LeagueComment[] {
    return this.db
      .select({
        id: leagueComments.id,
        teamId: leagueComments.teamId,
        memberId: leagueComments.memberId,
        targetType: leagueComments.targetType,
        targetId: leagueComments.targetId,
        body: leagueComments.body,
        createdAt: leagueComments.createdAt,
        authorName: leagueMembers.displayName,
      })
      .from(leagueComments)
      .innerJoin(leagueMembers, eq(leagueComments.memberId, leagueMembers.id))
      .where(eq(leagueComments.teamId, teamId))
      .orderBy(desc(leagueComments.createdAt))
      .limit(limit)
      .all();
  }

  private requireMember(teamId: string, memberId: string): LeagueMember {
    const member = this.db
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.teamId, teamId)))
      .get();
    if (!member) throw new Error('LEAGUE_MEMBER_NOT_FOUND');
    return member;
  }
}
