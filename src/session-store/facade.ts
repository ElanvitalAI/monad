// SessionStore facade (UI-Core arc Phase U1).
//
// Unified subscribe+snapshot surface over the five session-scoped
// singletons. Callers see a single reactive store; the facade wires up
// onChange hooks in each underlying singleton and normalizes their
// updates into `SessionStoreEvent`s.
//
// Design notes:
// - The snapshot is rebuilt **lazily** on `snapshot()` from the
//   underlying singletons, so the facade stays O(1) memory — no
//   shadow copy that can drift. Subscribers still receive batched
//   events via a microtask flush so multiple mutations within one
//   tick collapse to a single callback.
// - `dispatch()` is a thin router; the canonical APIs still live on
//   the underlying singletons. Intended for ergonomics when a caller
//   wants a uniform action shape (future wire protocol).

import type { AcpSessionStore as AcpChatSessionStore } from '../acp/session-store.js';
import type { BackgroundManager } from '../acp/background-manager.js';
import type { AcpSessionPersistence } from '../acp/session-persistence.js';
import type { AcpAgentManager } from '../acp/agent-manager.js';
import type { DualRoleManager, ClientSessionRecord, ServerSessionRecord } from '../acp/dual-role-manager.js';
import type { SessionUri } from '../mss/uri/brand.js';
import { unsafeBrandSessionUri } from '../mss/uri/brand.js';

import type { SessionStoreEvent } from './events.js';
import type {
  SessionSnapshot,
  SessionStoreBackgroundView,
  SessionStoreChatMappingView,
  SessionStoreClientSessionView,
  SessionStorePersistedView,
  SessionStoreServerSessionView,
} from './shape.js';

/** Pluggable underlying-singleton getters. Production wiring passes
 *  the real `globalDualRoleManager()` etc.; tests pass fakes. */
export interface SessionStoreDeps {
  dualRole: () => DualRoleManager;
  chatMappings: () => AcpChatSessionStore;
  persistence: () => AcpSessionPersistence;
  agents: () => AcpAgentManager;
  background: () => BackgroundManager;
}

export type SessionStoreSelector<T> = (snap: SessionSnapshot) => T;
export type SessionStoreSubscriber<T> = (value: T, prev: T, snap: SessionSnapshot) => void;
export type SessionStoreRawSubscriber = (ev: SessionStoreEvent, snap: SessionSnapshot) => void;

export type SessionStoreDispatchAction =
  | { type: 'closeClientSession'; sessionId: SessionUri; cascade?: boolean }
  | { type: 'cancelBackground'; id: string }
  | { type: 'dropAgent'; backendId: string; cwd: string }
  | { type: 'deleteChatMapping'; chatId: string; backendId: string; threadId?: string }
  | { type: 'removePersisted'; sessionId: SessionUri };

export interface SessionStore {
  snapshot(): SessionSnapshot;

  /** Subscribe to a selector-derived slice. Callback only fires when
   *  the selected value changes (referential equality). */
  subscribe<T>(selector: SessionStoreSelector<T>, listener: SessionStoreSubscriber<T>): () => void;

  /** Raw event subscription — receives every event the facade emits.
   *  Prefer `subscribe(selector, …)` for UI; use `subscribeRaw` for
   *  logging / bridge adapters. */
  subscribeRaw(listener: SessionStoreRawSubscriber): () => void;

  /** Forward an action to the appropriate underlying singleton. */
  dispatch(action: SessionStoreDispatchAction): Promise<void>;
}

function toClientView(r: ClientSessionRecord): SessionStoreClientSessionView {
  // MSS M1.1 Phase B2 — DRM records still carry `id: string`; the
  // SessionUri brand is re-applied at the facade so downstream
  // consumers observe the typed narrowing. Phase B3 will migrate
  // DRM records natively and the casts here become no-ops.
  const v: SessionStoreClientSessionView = {
    sessionId: unsafeBrandSessionUri(r.id),
    backendId: r.backendId,
    backendSessionId: r.backendSessionId,
    cwd: r.cwd,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    chainDepth: r.chainDepth,
    activeHops: r.activeHops,
  };
  if (r.parentSessionId !== undefined) v.parentSessionId = unsafeBrandSessionUri(r.parentSessionId);
  if (r.model !== undefined) v.model = r.model;
  if (r.permissionMode !== undefined) v.permissionMode = r.permissionMode;
  return v;
}

function toServerView(r: ServerSessionRecord): SessionStoreServerSessionView {
  return {
    sessionId: unsafeBrandSessionUri(r.id),
    backendSessionId: r.backendSessionId,
    cwd: r.cwd,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    activeHops: r.activeHops,
  };
}

class SessionStoreImpl implements SessionStore {
  private rawListeners = new Set<SessionStoreRawSubscriber>();
  private selectorListeners = new Set<{
    selector: SessionStoreSelector<unknown>;
    listener: SessionStoreSubscriber<unknown>;
    last: unknown;
  }>();
  private flushScheduled = false;
  private pendingEvents: SessionStoreEvent[] = [];
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: SessionStoreDeps) {
    this.attachHooks();
  }

  snapshot(): SessionSnapshot {
    const drm = this.deps.dualRole();
    const clients: SessionStoreClientSessionView[] = [];
    const servers: SessionStoreServerSessionView[] = [];
    for (const r of drm.list('client')) {
      if (r.kind === 'client') clients.push(toClientView(r));
    }
    for (const r of drm.list('server')) {
      if (r.kind === 'server') servers.push(toServerView(r));
    }

    const bgs: SessionStoreBackgroundView[] = [];
    for (const r of this.deps.background().list()) {
      const v: SessionStoreBackgroundView = {
        id: r.id,
        clientSessionId: unsafeBrandSessionUri(r.clientSessionId),
        backendId: r.backendId,
        backendSessionId: r.backendSessionId,
        cwd: r.cwd,
        state: r.state,
        startedAt: r.startedAt,
        lastSeenAt: r.lastSeenAt,
      };
      if (r.endedAt !== undefined) v.endedAt = r.endedAt;
      if (r.origin !== undefined) v.origin = r.origin;
      bgs.push(v);
    }

    const agents = this.deps.agents().listAgents();

    const chatMappings: SessionStoreChatMappingView[] = this.deps.chatMappings().list().map((r) => {
      const v: SessionStoreChatMappingView = {
        chatId: r.chatId,
        backendId: r.backendId,
        sessionId: unsafeBrandSessionUri(r.sessionId),
        updatedAt: r.updatedAt,
      };
      if (r.threadId !== undefined) v.threadId = r.threadId;
      return v;
    });

    const persisted: SessionStorePersistedView[] = this.deps.persistence().list().map((p) => ({
      sessionId: unsafeBrandSessionUri(p.sessionId),
      backendId: p.backendId,
      savedAt: new Date(p.lastSeenAt).toISOString(),
    }));

    return { clientSessions: clients, serverSessions: servers, backgroundSessions: bgs, agents, chatMappings, persisted };
  }

  subscribe<T>(selector: SessionStoreSelector<T>, listener: SessionStoreSubscriber<T>): () => void {
    const entry = {
      selector: selector as SessionStoreSelector<unknown>,
      listener: listener as SessionStoreSubscriber<unknown>,
      last: selector(this.snapshot()) as unknown,
    };
    this.selectorListeners.add(entry);
    return () => { this.selectorListeners.delete(entry); };
  }

  subscribeRaw(listener: SessionStoreRawSubscriber): () => void {
    this.rawListeners.add(listener);
    return () => { this.rawListeners.delete(listener); };
  }

  async dispatch(action: SessionStoreDispatchAction): Promise<void> {
    switch (action.type) {
      case 'closeClientSession':
        await this.deps.dualRole().clientSessionClose(action.sessionId, action.cascade !== undefined ? { cascade: action.cascade } : {});
        return;
      case 'cancelBackground':
        await this.deps.background().cancel(action.id, async () => { /* caller-supplied doCancel 은 facade 에서 모름 — singleton 이 이미 등록된 handler 사용 */ });
        return;
      case 'dropAgent':
        this.deps.agents().drop(action.backendId, action.cwd);
        return;
      case 'deleteChatMapping':
        this.deps.chatMappings().delete(action.chatId, action.backendId, action.threadId);
        return;
      case 'removePersisted':
        this.deps.persistence().remove(action.sessionId);
        return;
    }
    const exhaustive: never = action;
    throw new Error(`SessionStore.dispatch: unknown action ${JSON.stringify(exhaustive)}`);
  }

  /** Test-only teardown. */
  detach(): void {
    for (const u of this.unsubscribers) {
      try { u(); } catch { /* best-effort */ }
    }
    this.unsubscribers = [];
    this.rawListeners.clear();
    this.selectorListeners.clear();
    this.pendingEvents = [];
    this.flushScheduled = false;
  }

  private attachHooks(): void {
    const emit = (ev: SessionStoreEvent): void => this.enqueue(ev);

    // DualRoleManager — new onChange hook, mapped to SessionStoreEvent.
    this.unsubscribers.push(
      this.deps.dualRole().onChange((ev) => {
        switch (ev.kind) {
          case 'client-registered': {
            // M1.1 Phase B3 — DRM events now carry SessionUri directly,
            // so the facade only forwards (no re-brand cast needed).
            const mapped: SessionStoreEvent = {
              kind: 'client-session-registered',
              sessionId: ev.sessionId,
              backendId: ev.backendId,
              backendSessionId: ev.backendSessionId,
              cwd: ev.cwd,
            };
            if (ev.parentSessionId !== undefined) mapped.parentSessionId = ev.parentSessionId;
            emit(mapped);
            return;
          }
          case 'client-evicted':
            emit({ kind: 'client-session-evicted', sessionId: ev.sessionId, backendId: ev.backendId, backendSessionId: ev.backendSessionId });
            return;
          case 'client-turn-ended':
            emit({ kind: 'client-session-turn-ended', sessionId: ev.sessionId, backendId: ev.backendId, backendSessionId: ev.backendSessionId });
            return;
          case 'server-registered':
            emit({ kind: 'server-session-registered', sessionId: ev.sessionId, backendSessionId: ev.backendSessionId, cwd: ev.cwd });
            return;
          case 'server-unregistered':
            emit({ kind: 'server-session-unregistered', sessionId: ev.sessionId, backendSessionId: ev.backendSessionId });
            return;
        }
      }),
    );

    // AcpChatSessionStore — new onChange hook, already emits SessionStoreEvent-compatible shape.
    this.unsubscribers.push(
      this.deps.chatMappings().onChange((ev) => {
        if (ev.kind === 'chat-mapping-set') {
          const mapped: SessionStoreEvent = {
            kind: 'chat-mapping-set',
            chatId: ev.chatId,
            backendId: ev.backendId,
            sessionId: unsafeBrandSessionUri(ev.sessionId),
          };
          if (ev.threadId !== undefined) mapped.threadId = ev.threadId;
          emit(mapped);
        } else {
          const mapped: SessionStoreEvent = {
            kind: 'chat-mapping-deleted',
            chatId: ev.chatId,
            backendId: ev.backendId,
          };
          if (ev.threadId !== undefined) mapped.threadId = ev.threadId;
          emit(mapped);
        }
      }),
    );

    // AcpSessionPersistence — new onChange hook.
    this.unsubscribers.push(
      this.deps.persistence().onChange((ev) => {
        if (ev.kind === 'persistence-updated') {
          emit({ kind: 'persistence-updated', sessionId: unsafeBrandSessionUri(ev.sessionId), backendId: ev.backendId });
        } else {
          emit({ kind: 'persistence-removed', sessionId: unsafeBrandSessionUri(ev.sessionId) });
        }
      }),
    );

    // AcpAgentManager — new onChange hook.
    this.unsubscribers.push(
      this.deps.agents().onChange((ev) => {
        if (ev.kind === 'agent-attached') {
          emit({ kind: 'agent-attached', backendId: ev.backendId, cwd: ev.cwd });
        } else {
          emit({ kind: 'agent-dropped', backendId: ev.backendId, cwd: ev.cwd });
        }
      }),
    );

    // BackgroundManager — reuse existing onStateChange; add onCreate for
    // the start() path (the existing listener only fires on state
    // transitions, which start() doesn't actually produce — it creates
    // records already in 'running' state).
    this.unsubscribers.push(
      this.deps.background().onStateChange((record, prev) => {
        emit({
          kind: 'background-session-state-changed',
          id: record.id,
          prev,
          next: record.state,
        });
      }),
    );
    this.unsubscribers.push(
      this.deps.background().onCreate((record) => {
        emit({
          kind: 'background-session-started',
          id: record.id,
          clientSessionId: unsafeBrandSessionUri(record.clientSessionId),
          backendId: record.backendId,
          cwd: record.cwd,
        });
      }),
    );
  }

  private enqueue(ev: SessionStoreEvent): void {
    this.pendingEvents.push(ev);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const snap = this.snapshot();

    for (const ev of events) {
      for (const l of Array.from(this.rawListeners)) {
        try { l(ev, snap); } catch { /* listener errors must not wedge others */ }
      }
    }

    for (const entry of Array.from(this.selectorListeners)) {
      const next = entry.selector(snap);
      if (next !== entry.last) {
        const prev = entry.last;
        entry.last = next;
        try { entry.listener(next, prev, snap); } catch { /* best-effort */ }
      }
    }
  }
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore & { detach(): void } {
  return new SessionStoreImpl(deps);
}
