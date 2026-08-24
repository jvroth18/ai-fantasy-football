import { CodexAppServerClient, type CodexReadiness } from '@ai-ff/codex';

export type CodexLauncher = (cwd: string) => Promise<CodexAppServerClient>;

export class CodexClientManager {
  #clientPromise: Promise<CodexAppServerClient> | null = null;

  constructor(
    readonly launch: CodexLauncher = async (cwd) => await CodexAppServerClient.launch({ cwd }),
  ) {}

  async client(cwd: string): Promise<CodexAppServerClient> {
    if (!this.#clientPromise) {
      this.#clientPromise = this.launch(cwd).catch((error: unknown) => {
        this.#clientPromise = null;
        throw error;
      });
    }
    return await this.#clientPromise;
  }

  async readiness(cwd: string): Promise<CodexReadiness> {
    return await (await this.client(cwd)).readiness(cwd);
  }

  async close(): Promise<void> {
    if (!this.#clientPromise) return;
    const pending = this.#clientPromise;
    this.#clientPromise = null;
    const client = await pending.catch(() => null);
    if (client) await client.close();
  }
}
