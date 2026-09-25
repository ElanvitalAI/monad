// Unified event shape for the SessionStore facade (UI-Core arc Phase U1).
//
// Each of the five underlying singletons (DualRoleManager,
// AcpSessionStore, AcpSessionPersistence, AcpAgentManager,
// BackgroundManager) emits into this discriminated union so that a
// single subscriber can build a coherent view of session-scoped state
// without depending on five private APIs.
//
// Keep payloads **reference-free** of heavy objects (no AcpAgent
// subprocess handles, no full history snapshots) so the facade stays
// safe to cross a wire in Phase U4.
//
// MSS M1.1 Phase B2 — `sessionId` / `clientSessionId` / `parentSessionId`
// narrowed from plain `string` to the `SessionUri` brand. Underlying
// singletons still emit raw strings today; the facade casts at the
// boundary, so this widening is type-only.

import type { SessionUri } from '../mss/uri/brand.js';

export type SessionStoreEvent =
  | { kind: 'client-session-registered'; sessionId: SessionUri; backendId: string; backendSessionId: string; cwd: string; parentSessionId?: SessionUri }
  | { kind: 'client-session-evicted'; sessionId: SessionUri; backendId: string; backendSessionId: string }
  | { kind: 'client-session-turn-ended'; sessionId: SessionUri; backendId: string; backendSessionId: string }
  | { kind: 'server-session-registered'; sessionId: SessionUri; backendSessionId: string; cwd: string }
  | { kind: 'server-session-unregistered'; sessionId: SessionUri; backendSessionId: string }
  | { kind: 'background-session-started'; id: string; clientSessionId: SessionUri; backendId: string; cwd: string }
  | { kind: 'background-session-state-changed'; id: string; prev: string; next: string }
  | { kind: 'persistence-updated'; sessionId: SessionUri; backendId: string }
  | { kind: 'persistence-removed'; sessionId: SessionUri }
  | { kind: 'agent-attached'; backendId: string; cwd: string }
  | { kind: 'agent-dropped'; backendId: string; cwd: string }
  | { kind: 'chat-mapping-set'; chatId: string; backendId: string; sessionId: SessionUri; threadId?: string }
  | { kind: 'chat-mapping-deleted'; chatId: string; backendId: string; threadId?: string };

export type SessionStoreEventKind = SessionStoreEvent['kind'];
