/**
 * Intake REST surface — mirrors legacy pwa/intake.js endpoints exactly.
 * Endpoints (all under /v1/intake):
 *   GET    /                       list (q · state · source filters)
 *   POST   /                       create (text · mode · scheduleText)
 *   GET    /:id                    detail
 *   GET    /:id/review-view        review view config (questions · actions · chrome)
 *   GET    /:id/events             lifecycle events
 *   POST   /:id/{decide,apply,propose,archive,answer,replay}  mutations
 */

import type { DaemonClient } from './daemon-client';

export type IntakeState =
  | 'captured'
  | 'clarifying'
  | 'review-ready'
  | 'proposed'
  | 'applied'
  | 'scheduled'
  | 'archived';

export type IntakeSource = 'scratch' | 'telegram' | 'discord' | 'voice' | 'api';

export interface IntakeSession {
  intakeId: string;
  state: IntakeState;
  source: IntakeSource;
  updatedAt: string;
  decisionMode?: string;
  draft?: { title: string; summary: string };
}

export interface IntakeAttachment {
  name?: string;
  kind: string;
  mimeType?: string;
  localPath: string;
}

export interface IntakeDetail extends IntakeSession {
  raw?: { text?: string; transcriptSource?: string; attachments?: IntakeAttachment[] };
  channelContext?: { chatId?: string; guildId?: string };
}

export interface IntakeQuestion {
  id: string;
  title: string;
  inputType?: { placeholder?: string };
}

export interface IntakeAction {
  label: string;
  value: { intakeId: string; kind: string };
}

export interface IntakeReviewView {
  view: {
    chrome?: { title?: string };
    config?: {
      body?: string;
      questions?: IntakeQuestion[];
      actions?: IntakeAction[];
    };
  };
}

export interface IntakeEvent {
  kind: string;
  state: string;
  createdAt: string;
  detail?: unknown;
}

export interface IntakeListFilters {
  q?: string;
  state?: string;
  source?: string;
}

export interface CreateIntakePayload {
  text: string;
  mode?: 'review' | 'apply-now' | 'backlog-only' | 'schedule-followup';
  scheduleText?: string;
}

export class IntakeApi {
  constructor(private client: DaemonClient) {}

  async list(filters: IntakeListFilters = {}): Promise<{ sessions: IntakeSession[] }> {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.state) params.set('state', filters.state);
    if (filters.source) params.set('source', filters.source);
    const qs = params.toString();
    return this.client.fetchJson(`/v1/intake${qs ? `?${qs}` : ''}`);
  }

  detail(id: string): Promise<IntakeDetail> {
    return this.client.fetchJson(`/v1/intake/${encodeURIComponent(id)}`);
  }

  reviewView(id: string): Promise<IntakeReviewView> {
    return this.client.fetchJson(`/v1/intake/${encodeURIComponent(id)}/review-view`);
  }

  events(id: string): Promise<{ events: IntakeEvent[] }> {
    return this.client.fetchJson(`/v1/intake/${encodeURIComponent(id)}/events`);
  }

  create(payload: CreateIntakePayload): Promise<{ intakeId: string }> {
    return this.client.fetchJson('/v1/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  mutate(id: string, action: string, body: unknown = {}): Promise<{ intakeId: string }> {
    return this.client.fetchJson(`/v1/intake/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
