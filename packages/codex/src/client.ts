import { JsonRpcConnection } from './connection.js';
import { StdioJsonLineTransport, type StdioTransportOptions } from './transport.js';
import type {
  AccountKind,
  CodexModel,
  CodexReadiness,
  CodexSkill,
  CodexTurn,
  DecisionThreadOptions,
  StructuredTurnRequest,
} from './types.js';

type TurnWaiter = {
  resolve: (turn: CodexTurn) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTurn(value: unknown): CodexTurn {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string') {
    throw new Error('Codex returned an invalid turn');
  }
  const validStatuses = new Set(['completed', 'failed', 'inProgress', 'interrupted']);
  if (!validStatuses.has(value.status))
    throw new Error(`Unknown Codex turn status: ${value.status}`);
  return {
    id: value.id,
    status: value.status as CodexTurn['status'],
    items: Array.isArray(value.items)
      ? value.items.filter(isRecord).map((item) => ({ ...item, type: String(item.type) }))
      : [],
    error: value.error,
  };
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

export class CodexAppServerClient {
  readonly #completedTurns = new Map<string, CodexTurn>();
  readonly #turnWaiters = new Map<string, TurnWaiter>();
  readonly #unsubscribeNotifications: () => void;
  #initialized = false;

  constructor(readonly connection: JsonRpcConnection) {
    this.#unsubscribeNotifications = connection.onNotification((method, params) => {
      if (method !== 'turn/completed' || !isRecord(params) || typeof params.threadId !== 'string') {
        return;
      }
      const turn = asTurn(params.turn);
      const key = this.#turnKey(params.threadId, turn.id);
      const waiter = this.#turnWaiters.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.#turnWaiters.delete(key);
        waiter.resolve(turn);
      } else {
        this.#completedTurns.set(key, turn);
      }
    });
  }

  static async launch(options: StdioTransportOptions = {}): Promise<CodexAppServerClient> {
    const connection = new JsonRpcConnection(new StdioJsonLineTransport(options));
    const client = new CodexAppServerClient(connection);
    await client.initialize();
    return client;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await this.connection.request('initialize', {
      clientInfo: { name: 'ai-fantasy-football', title: 'AI Fantasy Football', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    await this.connection.notify('initialized');
    this.#initialized = true;
  }

  async readiness(cwd: string): Promise<CodexReadiness> {
    const [accountResult, modelsResult, skillsResult] = await Promise.allSettled([
      this.connection.request<unknown>('account/read', { refreshToken: false }),
      this.connection.request<unknown>('model/list', { includeHidden: false }),
      this.connection.request<unknown>('skills/list', { cwds: [cwd], forceReload: false }),
    ]);
    const issues: string[] = [];

    let authenticated = false;
    let accountKind: AccountKind = null;
    if (accountResult.status === 'fulfilled' && isRecord(accountResult.value)) {
      const account = accountResult.value.account;
      const requiresAuth = accountResult.value.requiresOpenaiAuth === true;
      if (isRecord(account) && typeof account.type === 'string') {
        if (
          account.type === 'apiKey' ||
          account.type === 'chatgpt' ||
          account.type === 'amazonBedrock'
        ) {
          accountKind = account.type;
        }
        authenticated = accountKind !== null;
      } else {
        authenticated = !requiresAuth;
      }
      if (!authenticated) issues.push('Codex CLI is not authenticated');
    } else {
      issues.push('Could not read Codex account status');
    }

    const models: CodexModel[] = [];
    if (modelsResult.status === 'fulfilled' && isRecord(modelsResult.value)) {
      const data = modelsResult.value.data;
      if (Array.isArray(data)) {
        for (const candidate of data) {
          if (!isRecord(candidate) || typeof candidate.id !== 'string') continue;
          models.push({
            id: candidate.id,
            model: typeof candidate.model === 'string' ? candidate.model : candidate.id,
            displayName:
              typeof candidate.displayName === 'string' ? candidate.displayName : candidate.id,
            isDefault: candidate.isDefault === true,
          });
        }
      }
      if (models.length === 0) issues.push('Codex returned no available models');
    } else {
      issues.push('Could not read the Codex model catalog');
    }

    const skills: CodexSkill[] = [];
    if (skillsResult.status === 'fulfilled' && isRecord(skillsResult.value)) {
      const entries = skillsResult.value.data;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
          for (const candidate of entry.skills) {
            if (!isRecord(candidate) || typeof candidate.name !== 'string') continue;
            skills.push({
              name: candidate.name,
              description: typeof candidate.description === 'string' ? candidate.description : '',
              enabled: candidate.enabled !== false,
              scope: typeof candidate.scope === 'string' ? candidate.scope : 'unknown',
            });
          }
        }
      }
    } else {
      issues.push('Could not read installed Codex skills');
    }

    const computerUseAvailable = skills.some((skill) => {
      const normalized = skill.name.toLowerCase().replaceAll('_', '-');
      return (
        skill.enabled && (normalized === 'computer-use' || normalized.endsWith(':computer-use'))
      );
    });
    if (!computerUseAvailable) issues.push('The Codex computer-use skill is not available');

    const readyForDecisions = authenticated && models.length > 0;
    return {
      authenticated,
      accountKind,
      models,
      skills,
      computerUseAvailable,
      readyForDecisions,
      readyForEspn: readyForDecisions && computerUseAvailable,
      issues,
    };
  }

  async startDecisionThread(
    options: DecisionThreadOptions,
  ): Promise<{ threadId: string; model: string }> {
    const params: Record<string, unknown> = {
      cwd: options.cwd,
      runtimeWorkspaceRoots: [options.cwd],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: options.ephemeral ?? false,
    };
    if (options.model) params.model = options.model;
    if (options.baseInstructions) params.baseInstructions = options.baseInstructions;

    const response = await this.connection.request<unknown>('thread/start', params);
    if (
      !isRecord(response) ||
      !isRecord(response.thread) ||
      typeof response.thread.id !== 'string' ||
      typeof response.model !== 'string'
    ) {
      throw new Error('Codex returned an invalid thread/start response');
    }
    return { threadId: response.thread.id, model: response.model };
  }

  async resumeDecisionThread(threadId: string, cwd: string): Promise<void> {
    await this.connection.request('thread/resume', {
      threadId,
      cwd,
      runtimeWorkspaceRoots: [cwd],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      excludeTurns: true,
    });
  }

  async runStructuredTurn<T>(request: StructuredTurnRequest<T>): Promise<T> {
    const params: Record<string, unknown> = {
      threadId: request.threadId,
      input: [{ type: 'text', text: request.prompt, text_elements: [] }],
      outputSchema: request.outputSchema,
    };
    if (request.model) params.model = request.model;
    if (request.effort) params.effort = request.effort;

    const response = await this.connection.request<unknown>('turn/start', params);
    if (!isRecord(response)) throw new Error('Codex returned an invalid turn/start response');
    const started = asTurn(response.turn);
    const completed =
      started.status === 'inProgress'
        ? await this.#waitForTurn(request.threadId, started.id, request.timeoutMs ?? 300_000)
        : started;

    if (completed.status !== 'completed') {
      throw new Error(`Codex turn ${completed.id} ended with status ${completed.status}`);
    }
    const messages = completed.items.filter(
      (item): item is typeof item & { text: string } =>
        item.type === 'agentMessage' && typeof item.text === 'string',
    );
    const finalMessage = messages.at(-1);
    if (!finalMessage) throw new Error('Codex completed without a final agent message');

    let value: unknown;
    try {
      value = JSON.parse(stripJsonFence(finalMessage.text));
    } catch (error) {
      throw new Error('Codex final message was not valid JSON', { cause: error });
    }
    return request.parse(value);
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.connection.request('turn/interrupt', { threadId, turnId });
  }

  async close(): Promise<void> {
    this.#unsubscribeNotifications();
    for (const waiter of this.#turnWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Codex client closed while waiting for a turn'));
    }
    this.#turnWaiters.clear();
    await this.connection.close();
  }

  async #waitForTurn(threadId: string, turnId: string, timeoutMs: number): Promise<CodexTurn> {
    const key = this.#turnKey(threadId, turnId);
    const completed = this.#completedTurns.get(key);
    if (completed) {
      this.#completedTurns.delete(key);
      return completed;
    }
    return await new Promise<CodexTurn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#turnWaiters.delete(key);
        reject(new Error(`Timed out waiting for Codex turn ${turnId}`));
      }, timeoutMs);
      this.#turnWaiters.set(key, { resolve, reject, timer });
    });
  }

  #turnKey(threadId: string, turnId: string): string {
    return `${threadId}:${turnId}`;
  }
}
