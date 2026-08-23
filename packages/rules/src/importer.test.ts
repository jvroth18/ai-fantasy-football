import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildCodexRuleExtractionRequest,
  compareRuleSets,
  describeRuleSource,
  parseJsonRuleSet,
  parseScoringCsv,
  type RuleSource,
} from './importer.js';
import { pprRulesFixture } from './test-fixtures.js';

const observedAt = '2026-08-23T12:00:00.000Z';

describe('rules ingestion', () => {
  it('parses a complete JSON rules upload exactly', () => {
    const rules = pprRulesFixture(randomUUID());
    const source: RuleSource = {
      name: 'league-rules.json',
      mimeType: 'application/json',
      bytes: new TextEncoder().encode(JSON.stringify(rules)),
      observedAt,
    };

    expect(parseJsonRuleSet(source)).toEqual(rules);
    expect(describeRuleSource(source).digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('turns scoring CSV rows into source-backed rules', () => {
    const source: RuleSource = {
      name: 'scoring.csv',
      mimeType: 'text/csv',
      bytes: new TextEncoder().encode(
        'stat,label,pointsPerUnit,unitSize\npassing_yards,"Passing yards",1,25\ninterceptions,Interceptions,-2,1',
      ),
      observedAt,
    };

    const rules = parseScoringCsv(source);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ stat: 'passing_yards', unitSize: 25 });
    expect(rules[1]?.evidence[0]?.locator).toBe('row:3');
  });

  it('builds a structured multimodal Codex extraction request', () => {
    const source: RuleSource = {
      name: 'settings.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      observedAt,
    };

    const request = buildCodexRuleExtractionRequest(source, '/private/tmp/settings.png');

    expect(request.localImagePath).toBe('/private/tmp/settings.png');
    expect(request.outputSchema).toMatchObject({ type: 'object' });
    expect(request.prompt).toContain('Do not guess missing values');
  });

  it('reports field-level conflicts while ignoring version metadata', () => {
    const left = pprRulesFixture();
    const right = {
      ...left,
      id: randomUUID(),
      revision: 2,
      waivers: { ...left.waivers, budget: 200 },
    };

    expect(compareRuleSets(left, right)).toEqual([
      { pointer: '/waivers/budget', left: 100, right: 200 },
    ]);
  });
});
