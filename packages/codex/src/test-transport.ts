import type { RpcMessage, RpcTransport } from './types.js';

export class MemoryRpcTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly #messageListeners = new Set<(message: unknown) => void>();
  readonly #closeListeners = new Set<(error?: Error) => void>();
  closed = false;

  async send(message: RpcMessage): Promise<void> {
    if (this.closed) throw new Error('Memory transport is closed');
    this.sent.push(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  emit(message: unknown): void {
    for (const listener of this.#messageListeners) listener(message);
  }

  fail(error: Error): void {
    for (const listener of this.#closeListeners) listener(error);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  response(method: string, result: unknown): void {
    const request = [...this.sent].reverse().find((message) => message.method === method);
    if (!request || (typeof request.id !== 'number' && typeof request.id !== 'string')) {
      throw new Error(`No request found for ${method}`);
    }
    this.emit({ jsonrpc: '2.0', id: request.id, result });
  }
}
