// ── AgentStatusStore (US1) ──
//
// Live 4-state status per session. Parsers (US2 claude-code JSONL,
// US3 codex heuristic) push transitions in; consumers (sessions-
// sidebar widget, toolbelt bar) subscribe to badge-color changes.
//
// set() is a no-op when the incoming status + lastEvent match the
// cached record — we never broadcast redundant events. This keeps
// the sidebar redraw budget proportional to actual state changes,
// not the PTY chunk rate.

import type { SessionStatus } from '../session/card.js';

export interface AgentStatusRecord {
  readonly status: SessionStatus;
  readonly updatedAt: number;
  /** Short human-readable tag for the most recent transition —
   *  surfaced by the UB3 "Status" toolbelt button and accessibility
   *  overlays. Optional: parsers may omit when the event itself has
   *  no interesting detail. */
  readonly lastEvent?: string;
}

export type AgentStatusSubscriber = (id: string, record: AgentStatusRecord) => void;

export interface AgentStatusStoreOpts {
  now?: () => number;
}

export class AgentStatusStore {
  private readonly records = new Map<string, AgentStatusRecord>();
  private readonly subs = new Set<AgentStatusSubscriber>();
  private readonly now: () => number;

  constructor(opts: AgentStatusStoreOpts = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  get(id: string): SessionStatus | undefined {
    return this.records.get(id)?.status;
  }

  getRecord(id: string): AgentStatusRecord | undefined {
    return this.records.get(id);
  }

  set(id: string, status: SessionStatus, lastEvent?: string): boolean {
    const prev = this.records.get(id);
    if (prev && prev.status === status && prev.lastEvent === lastEvent) {
      return false;
    }
    const rec: AgentStatusRecord = lastEvent !== undefined
      ? { status, updatedAt: this.now(), lastEvent }
      : { status, updatedAt: this.now() };
    this.records.set(id, rec);
    for (const cb of this.subs) cb(id, rec);
    return true;
  }

  subscribe(cb: AgentStatusSubscriber): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  clear(id: string): void {
    this.records.delete(id);
  }

  clearAll(): void {
    this.records.clear();
  }

  /** Snapshot — useful for the UB3 status button which wants a
   *  history-lite summary of every live session. */
  entries(): Array<[string, AgentStatusRecord]> {
    return [...this.records.entries()];
  }
}
