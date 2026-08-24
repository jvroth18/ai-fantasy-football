import { randomUUID } from 'node:crypto';

import { leagueRuleSetV1Schema, type LeagueRuleSetV1, type TeamConfigV1 } from '@ai-ff/domain';
import type { RuleSetRepository, TeamRepository } from '@ai-ff/db';
import {
  compareRuleSets,
  describeRuleSource,
  parseJsonRuleSet,
  parseScoringCsv,
  type RuleConflict,
  type RuleSource,
  type RuleSourceDescriptor,
} from '@ai-ff/rules';

export interface CodexRuleExtractor {
  extract(source: RuleSource, team: TeamConfigV1): Promise<LeagueRuleSetV1>;
}

export type RuleImportResult = {
  ruleSet: LeagueRuleSetV1;
  source: RuleSourceDescriptor;
  conflictsWithActive: RuleConflict[];
  extraction: 'deterministic_json' | 'deterministic_csv' | 'codex';
};

export class RuleImportService {
  constructor(
    readonly teams: TeamRepository,
    readonly ruleSets: RuleSetRepository,
    readonly extractor: CodexRuleExtractor | null = null,
    readonly now: () => Date = () => new Date(),
  ) {}

  async import(teamId: string, source: RuleSource): Promise<RuleImportResult> {
    const team = this.teams.getById(teamId);
    if (!team) throw new Error('Team not found');
    const existing = this.ruleSets.listForTeam(teamId);
    const active = team.activeRuleSetId
      ? this.ruleSets.getForTeam(teamId, team.activeRuleSetId)
      : null;
    let candidate: LeagueRuleSetV1;
    let extraction: RuleImportResult['extraction'];

    if (source.mimeType === 'application/json') {
      candidate = parseJsonRuleSet(source);
      extraction = 'deterministic_json';
    } else if (source.mimeType === 'text/csv') {
      const base = active ?? existing.at(-1) ?? null;
      if (!base) {
        throw new Error('A scoring CSV requires an existing full rule set as its base');
      }
      candidate = { ...base, scoring: parseScoringCsv(source) };
      extraction = 'deterministic_csv';
    } else {
      if (!this.extractor) throw new Error('Codex rule extraction is not available');
      candidate = leagueRuleSetV1Schema.parse(await this.extractor.extract(source, team));
      extraction = 'codex';
    }

    const descriptor = describeRuleSource(source);
    const observedAt = this.now().toISOString();
    const ruleSet = leagueRuleSetV1Schema.parse({
      ...candidate,
      id: randomUUID(),
      teamId: team.id,
      season: team.season,
      platform: team.platform,
      status: 'draft',
      revision: Math.max(0, ...existing.map((rule) => rule.revision)) + 1,
      evidence: [
        ...candidate.evidence,
        {
          sourceType: 'upload',
          sourceName: descriptor.name,
          sourceDigest: descriptor.digest,
          locator: descriptor.name,
          confidence: extraction === 'codex' ? 0.8 : 1,
          observedAt: source.observedAt,
        },
      ],
      createdAt: observedAt,
    });
    this.ruleSets.create(ruleSet);

    return {
      ruleSet,
      source: descriptor,
      conflictsWithActive: active ? compareRuleSets(active, ruleSet) : [],
      extraction,
    };
  }
}
