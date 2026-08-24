import type { PlayerReview, PlayerSeasonStats } from '@ai-ff/data';
import { playerIdentityV1Schema, type PlayerIdentityV1 } from '@ai-ff/domain';
import { and, asc, desc, eq, like } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import {
  dataSnapshots,
  newsItems,
  playerIdentities,
  playerReviews,
  playerSeasonStats,
  portalSnapshots,
} from './schema.js';

export type StoredDataSnapshot = typeof dataSnapshots.$inferSelect;

export class PlayerRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertMany(players: PlayerIdentityV1[]): number {
    const parsed = players.map((player) => playerIdentityV1Schema.parse(player));
    this.db.transaction((transaction) => {
      for (const player of parsed) {
        transaction
          .insert(playerIdentities)
          .values({
            id: player.id,
            fullName: player.fullName,
            position: player.position,
            nflTeam: player.nflTeam,
            espnId: player.espnId,
            sleeperId: player.sleeperId,
            gsisId: player.gsisId,
            mappingConfidence: Math.round(player.mappingConfidence * 10_000),
            identityJson: JSON.stringify(player),
            updatedAt: player.updatedAt,
          })
          .onConflictDoUpdate({
            target: playerIdentities.id,
            set: {
              fullName: player.fullName,
              position: player.position,
              nflTeam: player.nflTeam,
              espnId: player.espnId,
              sleeperId: player.sleeperId,
              gsisId: player.gsisId,
              mappingConfidence: Math.round(player.mappingConfidence * 10_000),
              identityJson: JSON.stringify(player),
              updatedAt: player.updatedAt,
            },
          })
          .run();
      }
    });
    return parsed.length;
  }

  list(): PlayerIdentityV1[] {
    return this.db
      .select()
      .from(playerIdentities)
      .orderBy(asc(playerIdentities.fullName))
      .all()
      .map((row) => playerIdentityV1Schema.parse(JSON.parse(row.identityJson)));
  }

  getByEspnId(espnId: string): PlayerIdentityV1 | null {
    const row = this.db
      .select()
      .from(playerIdentities)
      .where(eq(playerIdentities.espnId, espnId))
      .get();
    return row ? playerIdentityV1Schema.parse(JSON.parse(row.identityJson)) : null;
  }
}

export class DataSnapshotRepository {
  constructor(private readonly db: AppDatabase) {}

  record(input: typeof dataSnapshots.$inferInsert): void {
    this.db.insert(dataSnapshots).values(input).run();
  }

  latest(provider: string): StoredDataSnapshot | null {
    return (
      this.db
        .select()
        .from(dataSnapshots)
        .where(eq(dataSnapshots.provider, provider))
        .orderBy(desc(dataSnapshots.fetchedAt))
        .limit(1)
        .get() ?? null
    );
  }
}

export class NewsRepository {
  constructor(private readonly db: AppDatabase) {}

  upsert(input: typeof newsItems.$inferInsert): void {
    this.db
      .insert(newsItems)
      .values(input)
      .onConflictDoUpdate({
        target: newsItems.url,
        set: {
          title: input.title,
          source: input.source,
          publishedAt: input.publishedAt,
          newsJson: input.newsJson,
          fetchedAt: input.fetchedAt,
        },
      })
      .run();
  }

  listRecent(limit = 200): Array<typeof newsItems.$inferSelect> {
    return this.db.select().from(newsItems).orderBy(desc(newsItems.publishedAt)).limit(limit).all();
  }
}

export class PlayerIntelligenceRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertSeasonStats(records: PlayerSeasonStats[], updatedAt: string): number {
    this.db.transaction((transaction) => {
      for (const record of records) {
        transaction
          .insert(playerSeasonStats)
          .values({
            gsisId: record.gsisId,
            season: record.season,
            statsJson: JSON.stringify(record),
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [playerSeasonStats.gsisId, playerSeasonStats.season],
            set: { statsJson: JSON.stringify(record), updatedAt },
          })
          .run();
      }
    });
    return records.length;
  }

  listSeasonStats(): PlayerSeasonStats[] {
    return this.db
      .select()
      .from(playerSeasonStats)
      .orderBy(desc(playerSeasonStats.season))
      .all()
      .map((row) => JSON.parse(row.statsJson) as PlayerSeasonStats);
  }

  replaceReviews(reviews: PlayerReview[]): number {
    this.db.transaction((transaction) => {
      transaction.delete(playerReviews).run();
      for (const review of reviews) {
        transaction
          .insert(playerReviews)
          .values({
            playerId: review.playerId,
            overallRank: review.overallRank,
            position: review.position,
            positionRank: review.positionRank,
            scoreBasisPoints: Math.round(review.score * 100),
            reviewJson: JSON.stringify(review),
            generatedAt: review.generatedAt,
          })
          .run();
      }
    });
    return reviews.length;
  }

  listReviews(
    options: { position?: string; search?: string; limit?: number; offset?: number } = {},
  ): PlayerReview[] {
    const conditions = [];
    if (options.position) conditions.push(eq(playerReviews.position, options.position));
    if (options.search) conditions.push(like(playerIdentities.fullName, `%${options.search}%`));
    const query = this.db
      .select({ reviewJson: playerReviews.reviewJson })
      .from(playerReviews)
      .innerJoin(playerIdentities, eq(playerIdentities.id, playerReviews.playerId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(playerReviews.overallRank))
      .limit(Math.min(options.limit ?? 200, 5_000))
      .offset(options.offset ?? 0);
    return query.all().map((row) => JSON.parse(row.reviewJson) as PlayerReview);
  }

  getReview(playerId: string): PlayerReview | null {
    const row = this.db
      .select()
      .from(playerReviews)
      .where(eq(playerReviews.playerId, playerId))
      .get();
    return row ? (JSON.parse(row.reviewJson) as PlayerReview) : null;
  }
}

export type StoredPortalSnapshot = typeof portalSnapshots.$inferSelect;

export class PortalSnapshotRepository {
  constructor(private readonly db: AppDatabase) {}

  record(input: typeof portalSnapshots.$inferInsert): StoredPortalSnapshot {
    this.db.insert(portalSnapshots).values(input).run();
    const saved = this.db
      .select()
      .from(portalSnapshots)
      .where(eq(portalSnapshots.id, input.id))
      .get();
    if (!saved) throw new Error('Portal snapshot disappeared after insert');
    return saved;
  }

  latestForTeam(teamId: string): StoredPortalSnapshot | null {
    return (
      this.db
        .select()
        .from(portalSnapshots)
        .where(eq(portalSnapshots.teamId, teamId))
        .orderBy(desc(portalSnapshots.observedAt), desc(portalSnapshots.capturedAt))
        .limit(1)
        .get() ?? null
    );
  }

  listRecentForTeam(teamId: string, limit = 20): StoredPortalSnapshot[] {
    return this.db
      .select()
      .from(portalSnapshots)
      .where(eq(portalSnapshots.teamId, teamId))
      .orderBy(desc(portalSnapshots.observedAt), desc(portalSnapshots.capturedAt))
      .limit(limit)
      .all();
  }
}
