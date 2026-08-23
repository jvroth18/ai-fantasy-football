import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import type { RpcMessage, RpcTransport } from './types.js';

const STDERR_LIMIT = 8_192;

export type StdioTransportOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
};

export class StdioJsonLineTransport implements RpcTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #messageListeners = new Set<(message: unknown) => void>();
  readonly #closeListeners = new Set<(error?: Error) => void>();
  #stderr = '';
  #closed = false;

  constructor(options: StdioTransportOptions = {}) {
    this.#child = spawn(options.command ?? 'codex', options.args ?? ['app-server', '--stdio'], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#lines = createInterface({ input: this.#child.stdout });

    this.#lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const message: unknown = JSON.parse(line);
        for (const listener of this.#messageListeners) listener(message);
      } catch {
        this.#emitClose(new Error(`Codex app-server emitted invalid JSON: ${line.slice(0, 200)}`));
      }
    });

    this.#child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
    });
    this.#child.on('error', (error) => this.#emitClose(error));
    this.#child.on('close', (code, signal) => {
      if (this.#closed) return;
      const detail = this.#stderr.trim();
      this.#emitClose(
        new Error(
          `Codex app-server exited (code=${String(code)}, signal=${String(signal)})${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
  }

  async send(message: RpcMessage): Promise<void> {
    if (this.#closed || !this.#child.stdin.writable) {
      throw new Error('Codex app-server transport is closed');
    }
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.#child.stdin.write(line, (error) => (error ? reject(error) : resolve()));
    });
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#lines.close();
    this.#child.stdin.end();
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGTERM');
    }
  }

  #emitClose(error?: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) listener(error);
  }
}
