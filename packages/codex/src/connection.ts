import type { RpcId, RpcMessage, RpcTransport } from './types.js';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ServerRequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationListener = (method: string, params: unknown) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AppServerRpcError';
  }
}

export class JsonRpcConnection {
  readonly #pending = new Map<RpcId, PendingRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #serverRequestHandlers = new Map<string, ServerRequestHandler>();
  readonly #unsubscribeMessage: () => void;
  readonly #unsubscribeClose: () => void;
  #nextId = 1;
  #closed = false;

  constructor(
    readonly transport: RpcTransport,
    readonly requestTimeoutMs = 30_000,
  ) {
    this.#unsubscribeMessage = transport.onMessage((message) => this.#handleMessage(message));
    this.#unsubscribeClose = transport.onClose((error) => this.#shutdown(error));
  }

  async request<T>(
    method: string,
    params?: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    if (this.#closed) throw new Error('Codex app-server connection is closed');
    const id = this.#nextId++;
    const message: RpcMessage = { jsonrpc: '2.0', id, method };
    if (params !== undefined) message.params = params;

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      void this.transport.send(message).catch((error: unknown) => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.#closed) throw new Error('Codex app-server connection is closed');
    const message: RpcMessage = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    await this.transport.send(message);
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  handleServerRequest(method: string, handler: ServerRequestHandler): () => void {
    this.#serverRequestHandlers.set(method, handler);
    return () => this.#serverRequestHandlers.delete(method);
  }

  async close(): Promise<void> {
    this.#shutdown(new Error('Codex app-server connection closed by client'));
    await this.transport.close();
  }

  #handleMessage(message: unknown): void {
    if (!isRecord(message)) return;
    const id = message.id;
    const method = message.method;

    if ((typeof id === 'number' || typeof id === 'string') && typeof method !== 'string') {
      this.#handleResponse(id, message);
      return;
    }
    if (typeof method !== 'string') return;
    if (typeof id === 'number' || typeof id === 'string') {
      void this.#handleServerRequest(id, method, message.params);
      return;
    }
    for (const listener of this.#notificationListeners) listener(method, message.params);
  }

  #handleResponse(id: RpcId, message: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);

    if (isRecord(message.error)) {
      pending.reject(
        new AppServerRpcError(
          typeof message.error.message === 'string'
            ? message.error.message
            : 'Codex request failed',
          typeof message.error.code === 'number' ? message.error.code : -32_000,
          message.error.data,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  async #handleServerRequest(id: RpcId, method: string, params: unknown): Promise<void> {
    const handler = this.#serverRequestHandlers.get(method);
    if (!handler) {
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32_601, message: `Unsupported server request: ${method}` },
      });
      return;
    }

    try {
      const result = await handler(params);
      await this.transport.send({ jsonrpc: '2.0', id, result });
    } catch (error) {
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32_000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  #shutdown(error = new Error('Codex app-server connection closed')): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribeMessage();
    this.#unsubscribeClose();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
