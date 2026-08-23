import type { ActionExecutionResult, ActionLedger } from './types.js';

export class InMemoryActionLedger implements ActionLedger {
  readonly #results = new Map<string, ActionExecutionResult>();

  get(teamId: string, idempotencyKey: string): ActionExecutionResult | undefined {
    return this.#results.get(this.#key(teamId, idempotencyKey));
  }

  put(teamId: string, idempotencyKey: string, result: ActionExecutionResult): void {
    this.#results.set(this.#key(teamId, idempotencyKey), structuredClone(result));
  }

  #key(teamId: string, idempotencyKey: string): string {
    return `${teamId}:${idempotencyKey}`;
  }
}
