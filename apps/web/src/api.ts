import type {
  ActionExecutionResult,
  AutomationPolicy,
  Bootstrap,
  CreateTeamInput,
  RuleImportResult,
  FanDeskInput,
  FanDeskState,
  FanNetworkInput,
  FanNetworkState,
  LeagueTargetType,
  Strategy,
  Team,
  TeamDetail,
} from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      typeof record.message === 'string' ? record.message : `Request failed (${response.status})`,
      response.status,
      typeof record.error === 'string' ? record.error : null,
    );
  }
  return payload as T;
}

function json(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) };
}

async function fileAsBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('Could not encode file'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
};
const supportedRuleMimeTypes = new Set(Object.values(mimeByExtension));

export const api = {
  bootstrap: async () => await request<Bootstrap>('/api/bootstrap'),
  team: async (teamId: string) => await request<TeamDetail>(`/api/teams/${teamId}`),
  createTeam: async (input: CreateTeamInput) =>
    await request<Team>('/api/teams', json('POST', input)),
  saveStrategy: async (
    teamId: string,
    input: Omit<Strategy, 'id' | 'teamId' | 'createdAt' | 'updatedAt'>,
  ) => await request<Strategy>(`/api/teams/${teamId}/strategy`, json('PUT', input)),
  saveAutomation: async (teamId: string, policy: AutomationPolicy, confirmation?: string) =>
    await request<Team>(`/api/teams/${teamId}/automation`, json('PUT', { policy, confirmation })),
  uploadRules: async (teamId: string, file: File) => {
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
    if (file.size > 10 * 1024 * 1024) throw new Error('Rule upload exceeds 10 MB');
    const mimeType = supportedRuleMimeTypes.has(file.type) ? file.type : mimeByExtension[extension];
    if (!mimeType) throw new Error('Choose a PDF, image, text, Markdown, JSON, or CSV file');
    return await request<RuleImportResult>(
      `/api/teams/${teamId}/rules/import`,
      json('POST', {
        name: file.name,
        mimeType,
        contentBase64: await fileAsBase64(file),
      }),
    );
  },
  activateRules: async (teamId: string, ruleSetId: string) =>
    await request<Team>(`/api/teams/${teamId}/rules/${ruleSetId}/activate`, json('POST')),
  runJob: async (teamId: string, jobType: string) =>
    await request<unknown>(`/api/teams/${teamId}/jobs/${jobType}/run`, json('POST')),
  syncEspn: async (teamId: string) =>
    await request<unknown>(`/api/teams/${teamId}/espn/sync`, json('POST')),
  executeRecommendation: async (teamId: string, recommendationId: string) =>
    await request<ActionExecutionResult>(
      `/api/teams/${teamId}/recommendations/${recommendationId}/execute`,
      json('POST', { confirmation: 'EXECUTE ESPN ACTION' }),
    ),
  saveFanDesk: async (teamId: string, input: FanDeskInput) =>
    await request<FanDeskState['profile']>(`/api/teams/${teamId}/fan-desk`, json('PUT', input)),
  fanDesk: async (teamId: string) => await request<FanDeskState>(`/api/teams/${teamId}/fan-desk`),
  generateFanDesk: async (teamId: string) =>
    await request<{
      post: FanDeskState['posts'][number];
      email: FanDeskState['emails'][number] | null;
      syncWarning: string | null;
    }>(`/api/teams/${teamId}/fan-desk/generate`, json('POST')),
  saveFanNetwork: async (teamId: string, input: FanNetworkInput) =>
    await request<FanNetworkState['network']>(
      `/api/teams/${teamId}/fan-network`,
      json('PUT', input),
    ),
  fanNetwork: async (teamId: string) =>
    await request<FanNetworkState>(`/api/teams/${teamId}/fan-network`),
  emitFanNetworkEvent: async (
    teamId: string,
    input: { type: string; payload: Record<string, unknown> },
  ) => await request<unknown>(`/api/teams/${teamId}/fan-network/events`, json('POST', input)),
  addMember: async (teamId: string, displayName: string) =>
    await request<unknown>(`/api/teams/${teamId}/members`, json('POST', { displayName })),
  createLeaguePost: async (teamId: string, memberId: string, body: string) =>
    await request<unknown>(`/api/teams/${teamId}/posts`, json('POST', { memberId, body })),
  toggleLeagueReaction: async (
    teamId: string,
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
  ) =>
    await request<{ active: boolean }>(
      `/api/teams/${teamId}/reactions/toggle`,
      json('POST', { memberId, targetType, targetId }),
    ),
  createLeagueComment: async (
    teamId: string,
    memberId: string,
    targetType: LeagueTargetType,
    targetId: string,
    body: string,
  ) =>
    await request<unknown>(
      `/api/teams/${teamId}/comments`,
      json('POST', { memberId, targetType, targetId, body }),
    ),
  refreshFeed: async (teamId: string) =>
    await request<{
      status: 'complete' | 'partial';
      steps: Record<
        string,
        { status: 'complete' | 'skipped' | 'needs_attention'; message: string | null }
      >;
      refreshedAt: string;
    }>(`/api/teams/${teamId}/feed/refresh`, json('POST')),
};
