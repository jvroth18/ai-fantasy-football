import { describe, expect, it, vi } from 'vitest';

import { CodexAppServerClient } from './client.js';
import { JsonRpcConnection } from './connection.js';
import { MemoryRpcTransport } from './test-transport.js';

async function initializedClient(): Promise<{
  client: CodexAppServerClient;
  transport: MemoryRpcTransport;
}> {
  const transport = new MemoryRpcTransport();
  const client = new CodexAppServerClient(new JsonRpcConnection(transport));
  const initializing = client.initialize();
  await vi.waitFor(() =>
    expect(transport.sent.some((message) => message.method === 'initialize')).toBe(true),
  );
  transport.response('initialize', {
    userAgent: 'codex-cli/0.149.0',
    codexHome: '/private/codex',
    platformFamily: 'unix',
    platformOs: 'macos',
  });
  await initializing;
  return { client, transport };
}

describe('CodexAppServerClient', () => {
  it('performs the initialize handshake exactly once', async () => {
    const { client, transport } = await initializedClient();
    expect(transport.sent[0]).toMatchObject({
      method: 'initialize',
      params: {
        clientInfo: { name: 'ai-fantasy-football', version: '0.1.0' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
    expect(transport.sent[1]).toEqual({ jsonrpc: '2.0', method: 'initialized' });

    await client.initialize();
    expect(transport.sent).toHaveLength(2);
  });

  it('derives decision and ESPN readiness without reading credential files', async () => {
    const { client, transport } = await initializedClient();
    const checking = client.readiness('/project');
    await vi.waitFor(() =>
      expect(
        transport.sent.filter((message) =>
          ['account/read', 'model/list', 'skills/list'].includes(String(message.method)),
        ),
      ).toHaveLength(3),
    );
    transport.response('account/read', {
      account: { type: 'chatgpt', email: 'private@example.com', planType: 'plus' },
      requiresOpenaiAuth: true,
    });
    transport.response('model/list', {
      data: [
        {
          id: 'gpt-5.6-codex',
          model: 'gpt-5.6-codex',
          displayName: 'GPT-5.6 Codex',
          isDefault: true,
        },
      ],
      nextCursor: null,
    });
    transport.response('skills/list', {
      data: [
        {
          cwd: '/project',
          skills: [
            {
              name: 'computer-use:computer-use',
              description: 'Operate local apps',
              enabled: true,
              scope: 'system',
            },
          ],
          errors: [],
        },
      ],
    });

    await expect(checking).resolves.toMatchObject({
      authenticated: true,
      accountKind: 'chatgpt',
      computerUseAvailable: true,
      readyForDecisions: true,
      readyForEspn: true,
      issues: [],
    });
    expect(await checking).not.toHaveProperty('email');
  });

  it('starts read-only decision threads and returns validated structured output', async () => {
    const { client, transport } = await initializedClient();
    const starting = client.startDecisionThread({ cwd: '/project', model: 'gpt-5.6-codex' });
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.method === 'thread/start')).toBe(true),
    );
    const startMessage = transport.sent.find((message) => message.method === 'thread/start');
    expect(startMessage?.params).toMatchObject({
      cwd: '/project',
      runtimeWorkspaceRoots: ['/project'],
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    transport.response('thread/start', {
      thread: { id: 'thread-1' },
      model: 'gpt-5.6-codex',
    });
    await expect(starting).resolves.toEqual({ threadId: 'thread-1', model: 'gpt-5.6-codex' });

    const running = client.runStructuredTurn({
      threadId: 'thread-1',
      prompt: 'Rank these waiver candidates.',
      outputSchema: {
        type: 'object',
        properties: { add: { type: 'string' } },
        required: ['add'],
        additionalProperties: false,
      },
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('add' in value) ||
          typeof value.add !== 'string'
        ) {
          throw new Error('Invalid recommendation');
        }
        return { add: value.add };
      },
    });
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.method === 'turn/start')).toBe(true),
    );
    const turnMessage = transport.sent.find((message) => message.method === 'turn/start');
    expect(turnMessage?.params).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Rank these waiver candidates.', text_elements: [] }],
    });
    transport.response('turn/start', {
      turn: { id: 'turn-1', status: 'inProgress', items: [] },
    });
    transport.emit({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', text: '{"add":"Player A"}' }],
        },
      },
    });
    await expect(running).resolves.toEqual({ add: 'Player A' });
  });

  it('interrupts exact turns and rejects invalid final JSON', async () => {
    const { client, transport } = await initializedClient();
    const interrupting = client.interrupt('thread-1', 'turn-9');
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.method === 'turn/interrupt')).toBe(true),
    );
    const interruptMessage = transport.sent.find((message) => message.method === 'turn/interrupt');
    expect(interruptMessage?.params).toEqual({ threadId: 'thread-1', turnId: 'turn-9' });
    transport.response('turn/interrupt', {});
    await interrupting;

    const running = client.runStructuredTurn({
      threadId: 'thread-1',
      prompt: 'Return JSON.',
      outputSchema: { type: 'object' },
      parse: (value) => value,
    });
    await vi.waitFor(() =>
      expect(transport.sent.filter((message) => message.method === 'turn/start')).toHaveLength(1),
    );
    transport.response('turn/start', {
      turn: {
        id: 'turn-bad',
        status: 'completed',
        items: [{ type: 'agentMessage', text: 'not json' }],
      },
    });
    await expect(running).rejects.toThrow('final message was not valid JSON');
  });
});
