import { playerIdentityV1Schema, type PlayerIdentityV1 } from '@ai-ff/domain';
import { asc, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { dataSnapshots, newsItems, playerIdentities } from './schema.js';

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
