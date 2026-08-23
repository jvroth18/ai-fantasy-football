import { createHash } from 'node:crypto';

import {
  leagueRuleSetV1Schema,
  scoringRuleSchema,
  type LeagueRuleSetV1,
  type ScoringRule,
  type SourceEvidence,
} from '@ai-ff/domain';
import { z } from 'zod';

export const supportedRuleMimeTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
] as const;

export type SupportedRuleMimeType = (typeof supportedRuleMimeTypes)[number];

export type RuleSource = {
  name: string;
  mimeType: SupportedRuleMimeType;
  bytes: Uint8Array;
  observedAt: string;
};

export type RuleSourceDescriptor = {
  name: string;
  mimeType: SupportedRuleMimeType;
  digest: string;
  byteLength: number;
  observedAt: string;
};

export type CodexRuleExtractionRequest = {
  source: RuleSourceDescriptor;
  prompt: string;
  outputSchema: Record<string, unknown>;
  localImagePath: string | null;
  textContent: string | null;
};

export type RuleConflict = {
  pointer: string;
  left: unknown;
  right: unknown;
};

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function describeRuleSource(source: RuleSource): RuleSourceDescriptor {
  return {
    name: source.name,
    mimeType: source.mimeType,
    digest: digest(source.bytes),
    byteLength: source.bytes.byteLength,
    observedAt: source.observedAt,
  };
}

export function parseJsonRuleSet(source: RuleSource): LeagueRuleSetV1 {
  if (source.mimeType !== 'application/json') {
    throw new Error('JSON rule parsing requires application/json');
  }
  const text = new TextDecoder().decode(source.bytes);
  return leagueRuleSetV1Schema.parse(JSON.parse(text));
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

export function parseScoringCsv(source: RuleSource): ScoringRule[] {
  if (source.mimeType !== 'text/csv') throw new Error('Scoring CSV requires text/csv');
  const descriptor = describeRuleSource(source);
  const lines = new TextDecoder()
    .decode(source.bytes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines[0] ? parseCsvLine(lines[0]) : [];
  const required = ['stat', 'label', 'pointsPerUnit', 'unitSize'];
  if (!required.every((column) => header.includes(column))) {
    throw new Error(`Scoring CSV requires columns: ${required.join(', ')}`);
  }

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const record = Object.fromEntries(header.map((column, index) => [column, values[index] ?? '']));
    const evidence: SourceEvidence = {
      sourceType: 'upload',
      sourceName: source.name,
      sourceDigest: descriptor.digest,
      locator: `row:${rowIndex + 2}`,
      confidence: 1,
      observedAt: source.observedAt,
    };
    return scoringRuleSchema.parse({
      stat: record.stat,
      label: record.label,
      pointsPerUnit: Number(record.pointsPerUnit),
      unitSize: Number(record.unitSize),
      minimum: record.minimum ? Number(record.minimum) : undefined,
      maximum: record.maximum ? Number(record.maximum) : undefined,
      bonuses: [],
      evidence: [evidence],
    });
  });
}

export function buildCodexRuleExtractionRequest(
  source: RuleSource,
  localImagePath: string | null = null,
): CodexRuleExtractionRequest {
  const descriptor = describeRuleSource(source);
  const textMimeTypes: SupportedRuleMimeType[] = [
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
  ];
  const textContent = textMimeTypes.includes(source.mimeType)
    ? new TextDecoder().decode(source.bytes)
    : null;

  return {
    source: descriptor,
    prompt: [
      'Extract only fantasy-football league settings supported by LeagueRuleSetV1.',
      'Do not guess missing values. Use null-like omissions only where the schema permits them.',
      'Attach source evidence with a page, row, heading, or quoted locator for each scoring rule.',
      'Keep the result in draft status so a human can review it before activation.',
      `Source: ${descriptor.name} (${descriptor.mimeType}, sha256:${descriptor.digest})`,
    ].join('\n'),
    outputSchema: z.toJSONSchema(leagueRuleSetV1Schema) as Record<string, unknown>,
    localImagePath,
    textContent,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function compareRuleSets(left: LeagueRuleSetV1, right: LeagueRuleSetV1): RuleConflict[] {
  const ignored = new Set(['/id', '/status', '/revision', '/createdAt', '/evidence']);
  const conflicts: RuleConflict[] = [];

  function compare(leftValue: unknown, rightValue: unknown, pointer: string): void {
    if (ignored.has(pointer)) return;
    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      const length = Math.max(leftValue.length, rightValue.length);
      for (let index = 0; index < length; index += 1) {
        compare(leftValue[index], rightValue[index], `${pointer}/${index}`);
      }
      return;
    }
    if (isObject(leftValue) && isObject(rightValue)) {
      const keys = new Set([...Object.keys(leftValue), ...Object.keys(rightValue)]);
      for (const key of [...keys].sort()) {
        compare(leftValue[key], rightValue[key], `${pointer}/${key}`);
      }
      return;
    }
    if (!Object.is(leftValue, rightValue)) {
      conflicts.push({ pointer: pointer || '/', left: leftValue, right: rightValue });
    }
  }

  compare(left, right, '');
  return conflicts;
}
