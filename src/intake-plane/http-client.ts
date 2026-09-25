import type { IntakeNextAction } from './presenter.js';
import type { SignalUrgency } from '../input/control-signal.js';
import type {
  ControlSignalEmitRequest,
  ControlSignalEmitResponse,
} from '../input/control-signal-request.js';
import type { IntakeSource, IntakeState } from './types.js';
import type { WidgetSpec } from '../ui/declarative/spec.js';
import type { SimulationScenario } from '../sim/catalog.js';

export interface IntakeHttpClientOptions {
  baseUrl: string | URL;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export interface IntakeListFilters {
  state?: IntakeState;
  source?: IntakeSource;
  q?: string;
}

export interface IntakeCreateRequest {
  intakeId?: string;
  text: string;
  mode?: 'review' | 'apply-now' | 'backlog-only' | 'schedule-followup';
  scheduleText?: string;
  receivedAt?: string;
  actor?: { id?: string; display?: string };
  channelContext?: {
    chatId?: string;
    guildId?: string;
    threadId?: string;
    deviceId?: string;
  };
}

export interface IntakeActionRequest {
  force?: boolean;
  mode?: 'apply-now' | 'review-later' | 'backlog-only' | 'discard';
  questionId?: string;
  answer?: string;
  scheduleText?: string;
}

export interface IntakeSummary {
  intakeId: string;
  state: IntakeState;
  source: IntakeSource;
  receivedAt: string;
  updatedAt: string;
  actor: { id?: string; display?: string } | null;
  channelContext: {
    chatId?: string;
    guildId?: string;
    threadId?: string;
    deviceId?: string;
  } | null;
  draft: {
    title: string;
    summary: string;
    itemCount: number;
    openQuestionCount: number;
    suggestedMode: 'task-creation' | 'backlog-capture' | 'mixed';
  } | null;
  decisionMode: 'apply-now' | 'review-later' | 'backlog-only' | 'schedule-followup' | 'discard' | null;
  scheduleText: string | null;
}

export interface IntakeDetail extends IntakeSummary {
  draft: NonNullable<IntakeSummary['draft']> & {
    confidence: number;
    items: Array<{
      id: string;
      kind: string;
      text: string;
      links: string[];
      priorityHint: string | null;
      targetSurface: string | null;
      needsClarification: boolean;
      proposedAction: string;
    }>;
    openQuestions: Array<{
      id: string;
      scope: string;
      itemId: string | null;
      question: string;
      reason: string;
    }>;
  } | null;
  decision: {
    mode: string;
    approvedItemIds: string[];
    deferredItemIds: string[];
    clarifiedAnswers: Record<string, string | boolean>;
  } | null;
  proposal: {
    objective: string;
    goalSlug: string | null;
    preferredSurfaces: string[] | null;
    budgetUsdRemaining: number | null;
    scheduleText: string | null;
    contextNotes: string[];
  } | null;
  applyTokenPresent: boolean;
  nextActions: IntakeNextAction[];
  raw: {
    text: string;
    transcriptSource: 'voice' | 'audio' | null;
    attachments: Array<{
      name: string;
      kind: string;
      localPath: string;
      mimeType: string | null;
      sourceUrl: string | null;
      width: number | null;
      height: number | null;
      duration: number | null;
      sizeBytes: number | null;
    }>;
  };
}

export interface IntakeMutationResult extends IntakeDetail {
  output: string;
  applyToken?: string | null;
  taskIds?: string[] | null;
  taskId?: string | null;
  sourceId?: string;
}

export interface IntakeListResponse {
  sessions: IntakeSummary[];
}

export interface IntakeEventsResponse {
  intakeId: string;
  events: Array<{
    intakeId: string;
    kind: string;
    createdAt: string;
    state: string;
    detail?: Record<string, unknown>;
  }>;
}

export interface IntakeReviewViewResponse {
  intakeId: string;
  view: WidgetSpec;
}

export interface ControlSignalListFilters {
  kind?: string;
  channel?: string;
  surface?: string;
  sessionId?: string;
  minUrgency?: SignalUrgency;
  limit?: number;
}

export interface ControlSignalListResponse {
  total: number;
  limit: number;
  latest: {
    id: string;
    kind: string;
    urgency: SignalUrgency;
    source: unknown;
    payload?: unknown;
    scope?: {
      sessionId?: string;
      surface?: string;
      channel?: string;
      deviceId?: string;
    };
    mayPreempt?: boolean;
    expiresAt?: string;
    createdAt: string;
    consumedAt?: string;
  } | null;
  countsByKind: Record<string, number>;
  items: Array<NonNullable<ControlSignalListResponse['latest']>>;
}

export interface SimulationCatalogResponse {
  scenarios: SimulationScenario[];
}

export type { ControlSignalEmitRequest, ControlSignalEmitResponse };

export class IntakeHttpClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'IntakeHttpClientError';
    this.status = status;
    this.body = body;
  }
}

function trimSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function toBaseUrl(baseUrl: string | URL): string {
  return trimSlash(String(baseUrl));
}

function withQuery(baseUrl: string, path: string, filters?: IntakeListFilters): string {
  const url = new URL(path, `${baseUrl}/`);
  if (!filters) return url.toString();
  if (filters.state) url.searchParams.set('state', filters.state);
  if (filters.source) url.searchParams.set('source', filters.source);
  if (filters.q) url.searchParams.set('q', filters.q);
  return url.toString();
}

function withControlSignalQuery(baseUrl: string, path: string, filters?: ControlSignalListFilters): string {
  const url = new URL(path, `${baseUrl}/`);
  if (!filters) return url.toString();
  if (filters.kind) url.searchParams.set('kind', filters.kind);
  if (filters.channel) url.searchParams.set('channel', filters.channel);
  if (filters.surface) url.searchParams.set('surface', filters.surface);
  if (filters.sessionId) url.searchParams.set('sessionId', filters.sessionId);
  if (filters.minUrgency) url.searchParams.set('minUrgency', filters.minUrgency);
  if (typeof filters.limit === 'number') url.searchParams.set('limit', String(filters.limit));
  return url.toString();
}

export function normalizeIntakeDetail(payload: unknown): IntakeDetail {
  return payload as IntakeDetail;
}

export function normalizeIntakeReviewView(payload: unknown): WidgetSpec {
  return (payload as IntakeReviewViewResponse).view;
}

export function createIntakeHttpClient(
  opts: IntakeHttpClientOptions,
) {
  const baseUrl = toBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    const payload = isJson ? await response.json() : await response.text();
    if (!response.ok) {
      throw new IntakeHttpClientError(`${method} ${path} failed with ${response.status}`, response.status, payload);
    }
    return payload as T;
  }

  return {
    async create(input: IntakeCreateRequest): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', '/v1/intake', input),
      ) as IntakeMutationResult;
    },
    async list(filters?: IntakeListFilters): Promise<IntakeListResponse> {
      return request<IntakeListResponse>('GET', withQuery(baseUrl, '/v1/intake', filters).slice(baseUrl.length));
    },
    async show(intakeId: string): Promise<IntakeDetail> {
      return normalizeIntakeDetail(
        await request<IntakeDetail>('GET', `/v1/intake/${encodeURIComponent(intakeId)}`),
      );
    },
    async reviewView(intakeId: string): Promise<WidgetSpec> {
      return normalizeIntakeReviewView(
        await request<IntakeReviewViewResponse>('GET', `/v1/intake/${encodeURIComponent(intakeId)}/review-view`),
      );
    },
    async events(intakeId: string): Promise<IntakeEventsResponse> {
      return request<IntakeEventsResponse>('GET', `/v1/intake/${encodeURIComponent(intakeId)}/events`);
    },
    async replay(intakeId: string): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/replay`),
      ) as IntakeMutationResult;
    },
    async propose(intakeId: string): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/propose`),
      ) as IntakeMutationResult;
    },
    async apply(intakeId: string, input?: { force?: boolean }): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/apply`, input ?? {}),
      ) as IntakeMutationResult;
    },
    async answer(intakeId: string, input: { questionId: string; answer: string }): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/answer`, input),
      ) as IntakeMutationResult;
    },
    async decide(intakeId: string, input: { mode: NonNullable<IntakeActionRequest['mode']> }): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/decide`, input),
      ) as IntakeMutationResult;
    },
    async schedule(intakeId: string, input: { scheduleText: string }): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/schedule`, input),
      ) as IntakeMutationResult;
    },
    async archive(intakeId: string): Promise<IntakeMutationResult> {
      return normalizeIntakeDetail(
        await request<IntakeMutationResult>('POST', `/v1/intake/${encodeURIComponent(intakeId)}/archive`),
      ) as IntakeMutationResult;
    },
    async controlSignals(filters?: ControlSignalListFilters): Promise<ControlSignalListResponse> {
      return request<ControlSignalListResponse>(
        'GET',
        withControlSignalQuery(baseUrl, '/v1/control-signals', filters).slice(baseUrl.length),
      );
    },
    async emitControlSignal(input: ControlSignalEmitRequest): Promise<ControlSignalEmitResponse> {
      return request<ControlSignalEmitResponse>('POST', '/v1/control-signals', input);
    },
    async simulations(): Promise<SimulationCatalogResponse> {
      return request<SimulationCatalogResponse>('GET', '/v1/simulations');
    },
  };
}
