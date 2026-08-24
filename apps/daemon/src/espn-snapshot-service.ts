import { createHash, randomUUID } from 'node:crypto';

import type { PortalSnapshotRepository, StoredPortalSnapshot } from '@ai-ff/db';
import type { TeamConfigV1 } from '@ai-ff/domain';
import {
  espnPortalSnapshotSchema,
  type EspnPortalAdapter,
  type EspnPortalSnapshot,
} from '@ai-ff/espn';

export type PortalSnapshotView = Omit<StoredPortalSnapshot, 'snapshotJson'> & {
  snapshot: EspnPortalSnapshot;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function portalSnapshotDigest(snapshot: EspnPortalSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(snapshot)))
    .digest('hex');
}

export function portalSnapshotView(record: StoredPortalSnapshot): PortalSnapshotView {
  const { snapshotJson, ...metadata } = record;
  const snapshot = espnPortalSnapshotSchema.parse(JSON.parse(snapshotJson));
  if (portalSnapshotDigest(snapshot) !== record.digest) {
    throw new Error('Stored ESPN snapshot digest does not match its content');
  }
  return { ...metadata, snapshot };
}

export class EspnSnapshotService {
  constructor(
    readonly repository: PortalSnapshotRepository,
    readonly adapter: EspnPortalAdapter,
    readonly now: () => Date = () => new Date(),
  ) {}

  async sync(team: TeamConfigV1): Promise<PortalSnapshotView> {
    const snapshot = espnPortalSnapshotSchema.parse(
      await this.adapter.observe({ leagueId: team.espnLeagueId, teamId: team.espnTeamId }),
    );
    return this.record(team, snapshot);
  }

  record(team: TeamConfigV1, input: EspnPortalSnapshot): PortalSnapshotView {
    const snapshot = espnPortalSnapshotSchema.parse(input);
    if (!snapshot.signedIn) throw new Error('ESPN_AUTH_REQUIRED');
    if (snapshot.leagueId !== team.espnLeagueId || snapshot.teamId !== team.espnTeamId) {
      throw new Error('ESPN_BINDING_MISMATCH');
    }
    const capturedAt = this.now().toISOString();
    const observationAge = Date.parse(capturedAt) - Date.parse(snapshot.observedAt);
    if (observationAge < -5 * 60_000 || observationAge > 15 * 60_000) {
      throw new Error('ESPN_OBSERVATION_TIME_INVALID');
    }
    const record = this.repository.record({
      id: randomUUID(),
      teamId: team.id,
      leagueId: snapshot.leagueId,
      platformTeamId: snapshot.teamId,
      digest: portalSnapshotDigest(snapshot),
      snapshotJson: JSON.stringify(snapshot),
      observedAt: snapshot.observedAt,
      capturedAt,
    });
    return portalSnapshotView(record);
  }

  latest(teamId: string): PortalSnapshotView | null {
    const record = this.repository.latestForTeam(teamId);
    return record ? portalSnapshotView(record) : null;
  }
}
