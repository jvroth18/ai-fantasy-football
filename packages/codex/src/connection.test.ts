import { describe, expect, it, vi } from 'vitest';

import { JsonRpcConnection } from './connection.js';
import { MemoryRpcTransport } from './test-transport.js';

describe('JsonRpcConnection', () => {
  it('correlates responses and surfaces structured server errors', async () => {
    const transport = new MemoryRpcTransport();
    const connection = new JsonRpcConnection(transport);

    const success = connection.request<{ ok: boolean }>('example/read', { teamId: 'team-a' });
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    transport.response('example/read', { ok: true });
    await expect(success).resolves.toEqual({ ok: true });

    const failure = connection.request('example/fail');
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2));
    const request = transport.sent[1];
    transport.emit({
      jsonrpc: '2.0',
      id: request?.id,
      error: { code: 4_001, message: 'not ready', data: { retryable: false } },
    });
    await expect(failure).rejects.toMatchObject({
      code: 4_001,
      message: 'not ready',
    });
  });

  it('fails closed when the server asks for an unsupported operation', async () => {
    const transport = new MemoryRpcTransport();
    new JsonRpcConnection(transport);

    transport.emit({
      jsonrpc: '2.0',
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
    });
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    expect(transport.sent[0]).toMatchObject({
      id: 'approval-1',
      error: { code: -32_601 },
    });
  });

  it('times out bounded requests and rejects pending work on transport failure', async () => {
    const transport = new MemoryRpcTransport();
    const connection = new JsonRpcConnection(transport, 20);

    await expect(connection.request('slow/read')).rejects.toThrow('request timed out');

    const pending = connection.request('second/read', undefined, 1_000);
    transport.fail(new Error('app server exited'));
    await expect(pending).rejects.toThrow('app server exited');
  });
});
