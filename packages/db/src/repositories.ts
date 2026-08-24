import {
  automationPolicySchema,
  leagueRuleSetV1Schema,
  teamConfigV1Schema,
  type LeagueRuleSetV1,
  type TeamConfigV1,
} from '@ai-ff/domain';
import { and, asc, eq } from 'drizzle-orm';

import type { AppDatabase } from './database.js';
import { leagueRuleSets, teams } from './schema.js';

function toTeam(row: typeof teams.$inferSelect): TeamConfigV1 {
  return teamConfigV1Schema.parse({
    schemaVersion: 1,
    id: row.id,
    name: row.name,
    platform: row.platform,
    season: row.season,
    timeZone: row.timeZone,
    color: row.color,
    espnLeagueId: row.espnLeagueId,
    espnTeamId: row.espnTeamId,
    activeRuleSetId: row.activeRuleSetId,
    strategyProfileId: row.strategyProfileId,
    automation: JSON.parse(row.automationJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRuleSet(row: typeof leagueRuleSets.$inferSelect): LeagueRuleSetV1 {
  const stored = JSON.parse(row.ruleSetJson) as Record<string, unknown>;
  return leagueRuleSetV1Schema.parse({ ...stored, status: row.status });
}

export class TeamRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: TeamConfigV1): TeamConfigV1 {
    const team = teamConfigV1Schema.parse(input);
    this.db
      .insert(teams)
      .values({
        id: team.id,
        name: team.name,
        platform: team.platform,
        season: team.season,
        timeZone: team.timeZone,
        color: team.color,
        espnLeagueId: team.espnLeagueId,
        espnTeamId: team.espnTeamId,
        activeRuleSetId: team.activeRuleSetId,
        strategyProfileId: team.strategyProfileId,
        automationJson: JSON.stringify(team.automation),
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      })
      .run();
    return team;
  }

  list(): TeamConfigV1[] {
    return this.db.select().from(teams).orderBy(asc(teams.name)).all().map(toTeam);
  }

  getById(teamId: string): TeamConfigV1 | null {
    const row = this.db.select().from(teams).where(eq(teams.id, teamId)).get();
    return row ? toTeam(row) : null;
  }

  update(input: TeamConfigV1): TeamConfigV1 {
    const team = teamConfigV1Schema.parse(input);
    const result = this.db
      .update(teams)
      .set({
        name: team.name,
        timeZone: team.timeZone,
        color: team.color,
        espnLeagueId: team.espnLeagueId,
        espnTeamId: team.espnTeamId,
        activeRuleSetId: team.activeRuleSetId,
        strategyProfileId: team.strategyProfileId,
        automationJson: JSON.stringify(team.automation),
        updatedAt: team.updatedAt,
      })
      .where(eq(teams.id, team.id))
      .run();
    if (result.changes !== 1) throw new Error('Team not found');
    return team;
  }

  updateAutomation(
    teamId: string,
    automation: TeamConfigV1['automation'],
    updatedAt: string,
  ): TeamConfigV1 {
    const parsed = automationPolicySchema.parse(automation);
    const result = this.db
      .update(teams)
      .set({ automationJson: JSON.stringify(parsed), updatedAt })
      .where(eq(teams.id, teamId))
      .run();
    if (result.changes !== 1) throw new Error('Team not found');
    const team = this.getById(teamId);
    if (!team) throw new Error('Team disappeared during automation update');
    return team;
  }

  activateRuleSet(teamId: string, ruleSetId: string, updatedAt: string): TeamConfigV1 {
    const ruleSet = this.db
      .select({ id: leagueRuleSets.id })
      .from(leagueRuleSets)
      .where(and(eq(leagueRuleSets.id, ruleSetId), eq(leagueRuleSets.teamId, teamId)))
      .get();
    if (!ruleSet) throw new Error('Rule set does not belong to team');

    this.db.transaction((tx) => {
      tx.update(leagueRuleSets)
        .set({ status: 'retired' })
        .where(and(eq(leagueRuleSets.teamId, teamId), eq(leagueRuleSets.status, 'active')))
        .run();
      tx.update(leagueRuleSets)
        .set({ status: 'active' })
        .where(and(eq(leagueRuleSets.id, ruleSetId), eq(leagueRuleSets.teamId, teamId)))
        .run();
      tx.update(teams)
        .set({ activeRuleSetId: ruleSetId, updatedAt })
        .where(eq(teams.id, teamId))
        .run();
    });

    const team = this.getById(teamId);
    if (!team) throw new Error('Team disappeared during rules activation');
    return team;
  }
}

export class RuleSetRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: LeagueRuleSetV1): LeagueRuleSetV1 {
    const ruleSet = leagueRuleSetV1Schema.parse(input);
    this.db
      .insert(leagueRuleSets)
      .values({
        id: ruleSet.id,
        teamId: ruleSet.teamId,
        revision: ruleSet.revision,
        status: ruleSet.status,
        ruleSetJson: JSON.stringify(ruleSet),
        createdAt: ruleSet.createdAt,
      })
      .run();
    return ruleSet;
  }

  listForTeam(teamId: string): LeagueRuleSetV1[] {
    return this.db
      .select()
      .from(leagueRuleSets)
      .where(eq(leagueRuleSets.teamId, teamId))
      .orderBy(asc(leagueRuleSets.revision))
      .all()
      .map(toRuleSet);
  }

  getForTeam(teamId: string, ruleSetId: string): LeagueRuleSetV1 | null {
    const row = this.db
      .select()
      .from(leagueRuleSets)
      .where(and(eq(leagueRuleSets.teamId, teamId), eq(leagueRuleSets.id, ruleSetId)))
      .get();
    return row ? toRuleSet(row) : null;
  }
}
