import type { SurfaceAddress } from './address.js';

export type AuthoredSurfaceSourceKind =
  | 'llm-authored'
  | 'user-authored'
  | 'system-authored'
  | 'delegate-render';

export type AuthoredSurfaceTargetKind =
  | 'popup'
  | 'pane'
  | 'modal'
  | 'inline'
  | 'window';

export type AuthoredSurfaceRenderState =
  | 'pending'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface AuthoredSurfaceDescriptor {
  readonly authoredSurfaceId: string;
  readonly sourceKind: AuthoredSurfaceSourceKind;
  readonly targetKind: AuthoredSurfaceTargetKind;
  readonly renderState: AuthoredSurfaceRenderState;
  readonly persistent: boolean;
  readonly authorSessionId?: string;
  readonly linkedMessageId?: string;
  readonly workspaceId?: string;
  readonly surfaceId?: string;
  readonly addr?: SurfaceAddress;
  readonly title?: string;
  readonly errorMessage?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AuthoredSurfaceEventKind =
  | 'register'
  | 'update'
  | 'release';

export interface AuthoredSurfaceEvent {
  readonly kind: AuthoredSurfaceEventKind;
  readonly descriptor: AuthoredSurfaceDescriptor;
  readonly previous?: AuthoredSurfaceDescriptor;
}

export interface RegisterAuthoredSurfaceOpts {
  readonly sourceKind: AuthoredSurfaceSourceKind;
  readonly targetKind: AuthoredSurfaceTargetKind;
  readonly renderState?: AuthoredSurfaceRenderState;
  readonly persistent?: boolean;
  readonly authorSessionId?: string;
  readonly linkedMessageId?: string;
  readonly workspaceId?: string;
  readonly surfaceId?: string;
  readonly addr?: SurfaceAddress;
  readonly title?: string;
  readonly errorMessage?: string;
  readonly authoredSurfaceId?: string;
  readonly now?: () => number;
}

export interface UpdateAuthoredSurfaceOpts {
  readonly authoredSurfaceId: string;
  readonly renderState?: AuthoredSurfaceRenderState;
  readonly persistent?: boolean;
  readonly authorSessionId?: string;
  readonly linkedMessageId?: string;
  readonly workspaceId?: string | null;
  readonly surfaceId?: string | null;
  readonly addr?: SurfaceAddress | null;
  readonly title?: string | null;
  readonly errorMessage?: string | null;
  readonly now?: () => number;
}

export interface AuthoredSurfaceRegistry {
  register(opts: RegisterAuthoredSurfaceOpts): AuthoredSurfaceDescriptor;
  update(opts: UpdateAuthoredSurfaceOpts): AuthoredSurfaceDescriptor | undefined;
  get(authoredSurfaceId: string): AuthoredSurfaceDescriptor | undefined;
  list(): readonly AuthoredSurfaceDescriptor[];
  listActive(): readonly AuthoredSurfaceDescriptor[];
  listByState(state: AuthoredSurfaceRenderState): readonly AuthoredSurfaceDescriptor[];
  release(authoredSurfaceId: string, opts?: { now?: () => number }): AuthoredSurfaceDescriptor | undefined;
  on(kind: AuthoredSurfaceEventKind, cb: (event: AuthoredSurfaceEvent) => void): () => void;
  reset(): void;
}

const TERMINAL_STATES = new Set<AuthoredSurfaceRenderState>(['ready', 'error', 'cancelled']);

function canTransition(
  from: AuthoredSurfaceRenderState,
  to: AuthoredSurfaceRenderState,
): boolean {
  if (from === to) return true;
  if (from === 'pending') return to === 'ready' || to === 'error' || to === 'cancelled';
  if (from === 'ready') return to === 'error' || to === 'cancelled';
  if (from === 'error' || from === 'cancelled') return to === 'pending';
  return false;
}

class AuthoredSurfaceRegistryImpl implements AuthoredSurfaceRegistry {
  private readonly entries = new Map<string, AuthoredSurfaceDescriptor>();
  private readonly subs: Record<AuthoredSurfaceEventKind, Set<(event: AuthoredSurfaceEvent) => void>> = {
    register: new Set(),
    update: new Set(),
    release: new Set(),
  };
  private counter = 0;

  register(opts: RegisterAuthoredSurfaceOpts): AuthoredSurfaceDescriptor {
    const now = (opts.now ?? Date.now)();
    const descriptor: AuthoredSurfaceDescriptor = {
      authoredSurfaceId: opts.authoredSurfaceId ?? this.mintId(),
      sourceKind: opts.sourceKind,
      targetKind: opts.targetKind,
      renderState: opts.renderState ?? 'pending',
      persistent: opts.persistent ?? false,
      createdAt: now,
      updatedAt: now,
      ...(opts.authorSessionId !== undefined ? { authorSessionId: opts.authorSessionId } : {}),
      ...(opts.linkedMessageId !== undefined ? { linkedMessageId: opts.linkedMessageId } : {}),
      ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
      ...(opts.surfaceId !== undefined ? { surfaceId: opts.surfaceId } : {}),
      ...(opts.addr !== undefined ? { addr: opts.addr } : {}),
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
    };
    this.entries.set(descriptor.authoredSurfaceId, descriptor);
    this.fire('register', { kind: 'register', descriptor });
    return descriptor;
  }

  update(opts: UpdateAuthoredSurfaceOpts): AuthoredSurfaceDescriptor | undefined {
    const prev = this.entries.get(opts.authoredSurfaceId);
    if (!prev) return undefined;
    const nextState = opts.renderState ?? prev.renderState;
    if (!canTransition(prev.renderState, nextState)) {
      throw new Error(`invalid authored surface transition: ${prev.renderState} -> ${nextState}`);
    }
    const now = (opts.now ?? Date.now)();
    const next: AuthoredSurfaceDescriptor = {
      ...prev,
      renderState: nextState,
      persistent: opts.persistent ?? prev.persistent,
      updatedAt: now,
      ...(opts.authorSessionId !== undefined ? { authorSessionId: opts.authorSessionId } : {}),
      ...(opts.linkedMessageId !== undefined ? { linkedMessageId: opts.linkedMessageId } : {}),
      ...(opts.workspaceId === null ? { workspaceId: undefined } : opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
      ...(opts.surfaceId === null ? { surfaceId: undefined } : opts.surfaceId !== undefined ? { surfaceId: opts.surfaceId } : {}),
      ...(opts.addr === null ? { addr: undefined } : opts.addr !== undefined ? { addr: opts.addr } : {}),
      ...(opts.title === null ? { title: undefined } : opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.errorMessage === null ? { errorMessage: undefined } : opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
    };
    this.entries.set(next.authoredSurfaceId, next);
    this.fire('update', { kind: 'update', descriptor: next, previous: prev });
    return next;
  }

  get(authoredSurfaceId: string): AuthoredSurfaceDescriptor | undefined {
    return this.entries.get(authoredSurfaceId);
  }

  list(): readonly AuthoredSurfaceDescriptor[] {
    return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  listActive(): readonly AuthoredSurfaceDescriptor[] {
    return this.list().filter((entry) => entry.renderState !== 'cancelled');
  }

  listByState(state: AuthoredSurfaceRenderState): readonly AuthoredSurfaceDescriptor[] {
    return this.list().filter((entry) => entry.renderState === state);
  }

  release(authoredSurfaceId: string, opts: { now?: () => number } = {}): AuthoredSurfaceDescriptor | undefined {
    const prev = this.entries.get(authoredSurfaceId);
    if (!prev) return undefined;
    const now = (opts.now ?? Date.now)();
    const next = prev.renderState === 'cancelled' ? {
      ...prev,
      updatedAt: now,
    } : {
      ...prev,
      renderState: TERMINAL_STATES.has(prev.renderState) ? prev.renderState : 'cancelled' as const,
      updatedAt: now,
    };
    this.entries.delete(authoredSurfaceId);
    this.fire('release', { kind: 'release', descriptor: next, previous: prev });
    return next;
  }

  on(kind: AuthoredSurfaceEventKind, cb: (event: AuthoredSurfaceEvent) => void): () => void {
    this.subs[kind].add(cb);
    return () => { this.subs[kind].delete(cb); };
  }

  reset(): void {
    this.entries.clear();
    this.subs.register.clear();
    this.subs.update.clear();
    this.subs.release.clear();
  }

  private fire(kind: AuthoredSurfaceEventKind, event: AuthoredSurfaceEvent): void {
    for (const cb of [...this.subs[kind]]) {
      try {
        cb(event);
      } catch {
        // Observer failures must not destabilize registry state.
      }
    }
  }

  private mintId(): string {
    const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
    this.counter += 1;
    return `authored-${Date.now().toString(16)}-${this.counter.toString(16)}`;
  }
}

export function createAuthoredSurfaceRegistry(): AuthoredSurfaceRegistry {
  return new AuthoredSurfaceRegistryImpl();
}

let _global: AuthoredSurfaceRegistry | undefined;

export function getAuthoredSurfaceRegistry(): AuthoredSurfaceRegistry {
  if (!_global) _global = createAuthoredSurfaceRegistry();
  return _global;
}

export function __setGlobalAuthoredSurfaceRegistry(
  next: AuthoredSurfaceRegistry | undefined,
): AuthoredSurfaceRegistry | undefined {
  const prev = _global;
  _global = next;
  return prev;
}
