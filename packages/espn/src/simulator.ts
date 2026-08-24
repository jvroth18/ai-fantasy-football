import {
  espnPortalSnapshotSchema,
  portalActionResultSchema,
  type EspnPortalSnapshot,
  type PortalAction,
  type PortalActionResult,
} from './schemas.js';
import type { EspnPortalAdapter, PortalBinding } from './types.js';

type QueuedOutcome = {
  status: PortalActionResult['status'];
  apply: boolean;
  errorCode?: string;
};

export class SimulatedEspnPortal implements EspnPortalAdapter {
  #snapshot: EspnPortalSnapshot;
  readonly #outcomes: QueuedOutcome[] = [];
  readonly #clock: () => string;
  observeCalls = 0;
  performCalls = 0;

  constructor(snapshot: EspnPortalSnapshot, clock: () => string = () => new Date().toISOString()) {
    this.#snapshot = espnPortalSnapshotSchema.parse(structuredClone(snapshot));
    this.#clock = clock;
  }

  queueOutcome(outcome: QueuedOutcome): void {
    this.#outcomes.push(outcome);
  }

  setBinding(leagueId: string, teamId: string): void {
    this.#snapshot.leagueId = leagueId;
    this.#snapshot.teamId = teamId;
  }

  async observe(_binding: PortalBinding): Promise<EspnPortalSnapshot> {
    this.observeCalls += 1;
    this.#snapshot.observedAt = this.#clock();
    return structuredClone(this.#snapshot);
  }

  async perform(_binding: PortalBinding, action: PortalAction): Promise<PortalActionResult> {
    this.performCalls += 1;
    const queued = this.#outcomes.shift() ?? { status: 'submitted' as const, apply: true };
    if (queued.apply) {
      const rejected = this.#apply(action);
      if (rejected) {
        return portalActionResultSchema.parse({
          status: 'rejected',
          evidence: [rejected],
          errorCode: 'SIMULATOR_REJECTED',
        });
      }
    }
    return portalActionResultSchema.parse({
      status: queued.status,
      evidence: [`Simulator returned ${queued.status} for ${action.type}`],
      errorCode: queued.errorCode ?? null,
    });
  }

  #apply(action: PortalAction): string | null {
    switch (action.type) {
      case 'lineup_change': {
        const playerIn = this.#snapshot.roster.find(
          (entry) => entry.playerId === action.playerInId,
        );
        const playerOut = this.#snapshot.roster.find(
          (entry) => entry.playerId === action.playerOutId,
        );
        if (!playerIn || !playerOut) return 'Lineup player missing';
        if (playerIn.locked || playerOut.locked) return 'Lineup player locked';
        const previousSlot = playerIn.slot;
        playerIn.slot = action.targetSlot;
        playerOut.slot = previousSlot;
        return null;
      }
      case 'waiver_claim':
        this.#snapshot.waiverClaims.push({
          actionId: action.actionId,
          addPlayerId: action.addPlayerId,
          dropPlayerId: action.dropPlayerId,
          bid: action.bid,
          status: 'pending',
        });
        return null;
      case 'free_agent_move': {
        const addIndex = this.#snapshot.availablePlayers.findIndex(
          (player) => player.playerId === action.addPlayerId,
        );
        if (addIndex < 0) return 'Free agent is unavailable';
        const [added] = this.#snapshot.availablePlayers.splice(addIndex, 1);
        if (!added) return 'Free agent is unavailable';
        if (action.dropPlayerId !== null) {
          const dropIndex = this.#snapshot.roster.findIndex(
            (entry) => entry.playerId === action.dropPlayerId,
          );
          if (dropIndex < 0) return 'Drop player is missing';
          const [dropped] = this.#snapshot.roster.splice(dropIndex, 1);
          if (dropped) {
            this.#snapshot.availablePlayers.push({
              playerId: dropped.playerId,
              name: dropped.name,
              position: dropped.position,
              nflTeam: dropped.nflTeam,
              acquisitionType: 'waiver',
            });
          }
        }
        this.#snapshot.roster.push({
          playerId: added.playerId,
          name: added.name,
          position: added.position,
          nflTeam: added.nflTeam,
          slot: action.targetSlot,
          locked: false,
        });
        return null;
      }
      case 'draft_pick': {
        if (this.#snapshot.draft.status !== 'live') return 'Draft is not live';
        if (this.#snapshot.draft.onClockTeamId !== this.#snapshot.teamId)
          return 'Team is not on clock';
        const playerIndex = this.#snapshot.availablePlayers.findIndex(
          (player) => player.playerId === action.playerId,
        );
        if (playerIndex < 0) return 'Draft player is unavailable';
        const [player] = this.#snapshot.availablePlayers.splice(playerIndex, 1);
        if (!player) return 'Draft player is unavailable';
        this.#snapshot.draft.picks.push({
          actionId: action.actionId,
          teamId: this.#snapshot.teamId,
          playerId: action.playerId,
        });
        this.#snapshot.roster.push({
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          slot: 'BENCH',
          locked: false,
        });
        this.#snapshot.draft.onClockTeamId = null;
        return null;
      }
      case 'trade_offer':
        this.#snapshot.tradeOffers.push({
          actionId: action.actionId,
          opponentTeamId: action.opponentTeamId,
          sendPlayerIds: action.sendPlayerIds,
          receivePlayerIds: action.receivePlayerIds,
          status: 'pending',
        });
        return null;
    }
  }
}
