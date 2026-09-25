// Read-only snapshot shape exposed by the SessionStore facade.
//
// Consumers (dashboard panes · status-bar pill · notification bell ·
// future web/iPhone clients) call `store.snapshot()` once and subscribe
// for deltas. Fields mirror each underlying singleton's public
// projection but strip heavyweight handles (AcpAgent subprocess).
//
// MSS M1.1 Phase B2 — session identifiers are narrowed from plain
// `string` to the `SessionUri` brand so compile-time checks catch the
// "did you pass a raw string where a session id was expected?" drift.
// Legacy on-disk sessions (pre-M1.1) that don't parse as `session/<ULID>`
// flow through facade converters with an unchecked cast — the brand is
// a phantom type and has no runtime cost, so this is zero-risk for the
// snapshot shape itself.

import type { SessionUri } from '../mss/uri/brand.js';

export interface SessionStoreClientSessionView {
  sessionId: SessionUri;
  backendId: string;
  backendSessionId: string;
  cwd: string;
  createdAt: number;
  lastSeenAt: number;
  chainDepth: number;
  activeHops: number;
  parentSessionId?: SessionUri;
  model?: string;
  permissionMode?: 'plan' | 'auto' | 'default';
}

export interface SessionStoreServerSessionView {
  sessionId: SessionUri;
  backendSessionId: string;
  cwd: string;
  createdAt: number;
  lastSeenAt: number;
  activeHops: number;
}

export interface SessionStoreBackgroundView {
  id: string;
  clientSessionId: SessionUri;
  backendId: string;
  backendSessionId: string;
  cwd: string;
  state: string;
  startedAt: number;
  lastSeenAt: number;
  endedAt?: number;
  origin?: string;
}

export interface SessionStoreAgentView {
  backendId: string;
  cwd: string;
}

export interface SessionStoreChatMappingView {
  chatId: string;
  backendId: string;
  sessionId: SessionUri;
  threadId?: string;
  updatedAt: string;
}

export interface SessionStorePersistedView {
  sessionId: SessionUri;
  backendId: string;
  savedAt: string;
}

export interface SessionSnapshot {
  clientSessions: readonly SessionStoreClientSessionView[];
  serverSessions: readonly SessionStoreServerSessionView[];
  backgroundSessions: readonly SessionStoreBackgroundView[];
  agents: readonly SessionStoreAgentView[];
  chatMappings: readonly SessionStoreChatMappingView[];
  persisted: readonly SessionStorePersistedView[];
}

export const EMPTY_SESSION_SNAPSHOT: SessionSnapshot = {
  clientSessions: [],
  serverSessions: [],
  backgroundSessions: [],
  agents: [],
  chatMappings: [],
  persisted: [],
};
