import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import type { CodexAppServerClient, JsonValue } from '@ai-ff/codex';
import { leagueRuleSetV1Schema, type LeagueRuleSetV1, type TeamConfigV1 } from '@ai-ff/domain';
import { buildCodexRuleExtractionRequest, describeRuleSource, type RuleSource } from '@ai-ff/rules';

import type { CodexRuleExtractor } from './rule-import-service.js';

const INLINE_TEXT_LIMIT = 250_000;

function extension(source: RuleSource): string {
  const supplied = extname(source.name).toLowerCase();
  if (supplied && supplied.length <= 10) return supplied;
  return {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
    'text/csv': '.csv',
  }[source.mimeType];
}

export class CodexRuleExtractorService implements CodexRuleExtractor {
  readonly #workspaceRoot: string;
  readonly #uploadRoot: string;

  constructor(
    readonly client: CodexAppServerClient,
    workspaceRoot: string,
    uploadRoot: string,
  ) {
    this.#workspaceRoot = resolve(workspaceRoot);
    this.#uploadRoot = resolve(uploadRoot);
    if (
      this.#uploadRoot !== this.#workspaceRoot &&
      !this.#uploadRoot.startsWith(`${this.#workspaceRoot}${sep}`)
    ) {
      throw new Error('Rule upload directory must be inside the Codex workspace root');
    }
  }

  async extract(source: RuleSource, team: TeamConfigV1): Promise<LeagueRuleSetV1> {
    const descriptor = describeRuleSource(source);
    const decoded = ['text/plain', 'text/markdown'].includes(source.mimeType)
      ? new TextDecoder().decode(source.bytes)
      : null;
    const inlineText = decoded && decoded.length <= INLINE_TEXT_LIMIT ? decoded : null;
    let localPath: string | null = null;

    if (inlineText === null) {
      await mkdir(this.#uploadRoot, { recursive: true });
      localPath = join(this.#uploadRoot, `${descriptor.digest}${extension(source)}`);
      const partial = `${localPath}.partial`;
      await writeFile(partial, source.bytes, { mode: 0o600 });
      await rename(partial, localPath);
    }

    try {
      const extraction = buildCodexRuleExtractionRequest(source, localPath);
      const thread = await this.client.startDecisionThread({
        cwd: this.#workspaceRoot,
        ephemeral: true,
        baseInstructions: [
          'Extract fantasy football league rules only.',
          'Never mutate files, browser state, accounts, or league settings.',
          'Do not guess missing mechanics; report them through schema-valid conservative fields for human review.',
        ].join('\n'),
      });
      const locationInstruction = localPath
        ? `Read the local source at ${localPath}. Use the pdf:pdf skill for PDFs or image viewing for images.`
        : `Source text follows:\n---\n${inlineText ?? ''}\n---`;
      return await this.client.runStructuredTurn({
        threadId: thread.threadId,
        prompt: [
          extraction.prompt,
          `The destination team is ${team.name}, season ${team.season}, ESPN league ${team.espnLeagueId}.`,
          'Return a complete LeagueRuleSetV1 in draft status. Use valid UUIDs for provisional identifiers.',
          locationInstruction,
        ].join('\n'),
        outputSchema: extraction.outputSchema as unknown as JsonValue,
        parse: (value) => leagueRuleSetV1Schema.parse(value),
        timeoutMs: 300_000,
      });
    } finally {
      if (localPath) await unlink(localPath).catch(() => undefined);
    }
  }
}
