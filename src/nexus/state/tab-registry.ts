// NEXUS · tab registry (Phase N-1 PR α — minimal CRUD)
//
// In-memory map keyed by tab id. PR β fills it with first chat /
// webterm tabs; N-2 supervisor mutates `status` · `pid` · `restartCount`
// fields as health checks fire. The registry emits state-mutation
// events into NexusState.events so SSE subscribers (PR δ) see every
// transition.
//
// Single-writer rule: only the nexus process mutates this. PWA /
// external clients drive mutations via HTTP API (N-3) which routes
// through this registry.

import type { NexusState } from './state.js';
import { pushEvent } from './state.js';
import type { TabKind, TabSpec, TabState, TabStatus } from '../kinds/types.js';

export class TabRegistry {
  constructor(private readonly state: NexusState) {}

  list(): TabState[] {
    return Object.values(this.state.tabs);
  }

  listByKind(kind: TabKind): TabState[] {
    return this.list().filter((t) => t.spec.kind === kind);
  }

  get(id: string): TabState | undefined {
    return this.state.tabs[id];
  }

  has(id: string): boolean {
    return id in this.state.tabs;
  }

  register(spec: TabSpec, opts: { initialStatus?: TabStatus } = {}): TabState {
    if (this.has(spec.id)) {
      throw new Error(`tab id already registered: ${spec.id}`);
    }
    const tab: TabState = {
      spec,
      status: opts.initialStatus ?? 'idle',
      restartCount: 0,
      restartCountWindowStart: Date.now(),
    };
    this.state.tabs[spec.id] = tab;
    pushEvent(this.state, { kind: 'tab.created', tabId: spec.id, detail: { kind: spec.kind } });
    return tab;
  }

  unregister(id: string): boolean {
    if (!this.has(id)) return false;
    delete this.state.tabs[id];
    pushEvent(this.state, { kind: 'tab.down', tabId: id, detail: { reason: 'unregister' } });
    return true;
  }

  /** Update one or more fields on a tab. Caller emits semantic events
   *  (`tab.up` · `tab.unhealthy` · ...) — this method just patches state
   *  to keep mutation flow explicit at every junction. */
  patch(id: string, partial: Partial<Omit<TabState, 'spec'>>): TabState {
    const tab = this.state.tabs[id];
    if (!tab) throw new Error(`tab not found: ${id}`);
    Object.assign(tab, partial);
    return tab;
  }

  /** Snapshot for HTTP API responses + SSE state replay. Returns
   *  plain objects (no class refs) so JSON.stringify is direct. */
  snapshot(): TabState[] {
    return this.list().map((t) => ({ ...t, spec: { ...t.spec } }));
  }
}
