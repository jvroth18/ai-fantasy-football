export type RpcId = number | string;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RpcMessage = Record<string, unknown>;

export interface RpcTransport {
  send(message: RpcMessage): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: (error?: Error) => void): () => void;
  close(): Promise<void>;
}

export type AccountKind = 'apiKey' | 'chatgpt' | 'amazonBedrock' | null;

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
};

export type CodexSkill = {
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
};

export type CodexReadiness = {
  authenticated: boolean;
  accountKind: AccountKind;
  models: CodexModel[];
  skills: CodexSkill[];
  computerUseAvailable: boolean;
  readyForDecisions: boolean;
  readyForEspn: boolean;
  issues: string[];
};

export type TurnItem = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type CodexTurn = {
  id: string;
  status: 'completed' | 'failed' | 'inProgress' | 'interrupted';
  items: TurnItem[];
  error?: unknown;
};

export type StructuredTurnRequest<T> = {
  threadId: string;
  prompt: string;
  outputSchema: JsonValue;
  parse: (value: unknown) => T;
  model?: string;
  effort?: string;
  timeoutMs?: number;
};

export type DecisionThreadOptions = {
  cwd: string;
  model?: string;
  baseInstructions?: string;
  ephemeral?: boolean;
};
