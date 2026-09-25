// H5 Phase 2 · TTY snapshot primitive.
//
// Per-session ring buffer of point-in-time PTY state. Used by the
// channel-aware observer to freeze a moment of an embodied session
// for later recall (compare, time-travel preview, LLM context
// injection). PLAN-h5-embodied-agent-bus-phase-2.md §4.1.
//
// In-memory only — when H8 P1 (capture source registry) lands, the
// persist path swaps to ArtifactStore writes behind the same LLM
// tool shape. See PLAN §2 for the decoupling rationale.

import type { EmbodiedAgentSession } from './embodiment.js';

/** Captured PTY state at a point in time. Channels are a snapshot
 *  of the channel-router buffers at capture time; absent on sessions
 *  whose adapter doesn't register a channel hook. */
export interface TtySnapshot {
  readonly id: string;                          // 'snap-<seq>'
  readonly sessionId: string;
  readonly at: number;                          // epoch ms
  readonly screen: string;                      // raw head+tail buffer
  readonly channels?: Readonly<Record<string, string>>;
  readonly bytes: number;                       // for ring-budget math
  readonly label?: string;                      // caller-supplied tag
}

export interface TtySnapshotStoreOpts {
  /** Per-session max snapshots. Oldest evicted when exceeded. */
  readonly maxPerSession?: number;
  /** Global byte budget across all sessions. Oldest snapshots
   *  (regardless of session) evicted when exceeded. */
  readonly maxTotalBytes?: number;
}

const DEFAULT_MAX_PER_SESSION = 64;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024; // 16 MB

export class TtySnapshotStore {
  private readonly perSession = new Map<string, TtySnapshot[]>();
  private readonly byId = new Map<string, TtySnapshot>();
  private totalBytes = 0;
  private seq = 1;
  private readonly maxPerSession: number;
  private readonly maxTotalBytes: number;

  constructor(opts: TtySnapshotStoreOpts = {}) {
    this.maxPerSession = opts.maxPerSession ?? DEFAULT_MAX_PER_SESSION;
    this.maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  /** Record a snapshot. Enforces both per-session cap and global
   *  byte budget; evictions are oldest-first within their scope. */
  record(input: Omit<TtySnapshot, 'id' | 'bytes'> & { screen: string }): TtySnapshot {
    const channelsBytes = input.channels
      ? Object.values(input.channels).reduce((sum, v) => sum + (v?.length ?? 0), 0)
      : 0;
    const bytes = input.screen.length + channelsBytes;
    const snap: TtySnapshot = {
      ...input,
      id: `snap-${this.seq++}`,
      bytes,
    };
    this.pushToSession(snap);
    this.byId.set(snap.id, snap);
    this.totalBytes += snap.bytes;
    this.enforceGlobalBudget();
    return snap;
  }

  /** Capture current state from a live session. Calls
   *  `session.snapshot()` and records with the provided label. */
  async capture(
    session: EmbodiedAgentSession,
    opts: { label?: string; channels?: Record<string, string> } = {},
  ): Promise<TtySnapshot> {
    const screen = await session.snapshot();
    return this.record({
      sessionId: session.id,
      at: Date.now(),
      screen,
      channels: opts.channels,
      label: opts.label,
    });
  }

  get(id: string): TtySnapshot | undefined {
    return this.byId.get(id);
  }

  list(sessionId: string): readonly TtySnapshot[] {
    return this.perSession.get(sessionId) ?? [];
  }

  /** Session-scoped listing with optional newest-first ordering.
   *  Secondary sort by insertion seq (id tail) keeps ordering stable
   *  when multiple snapshots share the same `at` timestamp (common in
   *  fast-capture sequences where Date.now() hasn't ticked). */
  listNewestFirst(sessionId: string, limit?: number): readonly TtySnapshot[] {
    const all = this.list(sessionId);
    const sorted = [...all].sort((a, b) => {
      if (b.at !== a.at) return b.at - a.at;
      // id shape is 'snap-<N>' · higher N = newer.
      const seqA = Number(a.id.slice(5));
      const seqB = Number(b.id.slice(5));
      return seqB - seqA;
    });
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /** Drop all snapshots for a session (e.g. on session dispose).
   *  Returns number of records evicted. */
  dropSession(sessionId: string): number {
    const list = this.perSession.get(sessionId);
    if (!list) return 0;
    for (const snap of list) {
      this.byId.delete(snap.id);
      this.totalBytes -= snap.bytes;
    }
    this.perSession.delete(sessionId);
    return list.length;
  }

  stats(): { sessions: number; snapshots: number; bytes: number; budget: number } {
    return {
      sessions: this.perSession.size,
      snapshots: this.byId.size,
      bytes: this.totalBytes,
      budget: this.maxTotalBytes,
    };
  }

  /** Clear everything. Test isolation helper. */
  clear(): void {
    this.perSession.clear();
    this.byId.clear();
    this.totalBytes = 0;
    this.seq = 1;
  }

  private pushToSession(snap: TtySnapshot): void {
    let list = this.perSession.get(snap.sessionId);
    if (!list) {
      list = [];
      this.perSession.set(snap.sessionId, list);
    }
    list.push(snap);
    while (list.length > this.maxPerSession) {
      const dropped = list.shift();
      if (dropped) {
        this.byId.delete(dropped.id);
        this.totalBytes -= dropped.bytes;
      }
    }
  }

  private enforceGlobalBudget(): void {
    if (this.totalBytes <= this.maxTotalBytes) return;
    // Evict oldest across all sessions. Build a flat list sorted by
    // `at`, drop until under budget. Cost is O(n log n) which is
    // fine for cap 64 × a handful of sessions; if it grows we can
    // switch to a heap.
    const allEntries: Array<{ sessionId: string; snap: TtySnapshot }> = [];
    for (const [sessionId, list] of this.perSession) {
      for (const snap of list) {
        allEntries.push({ sessionId, snap });
      }
    }
    allEntries.sort((a, b) => a.snap.at - b.snap.at);
    let idx = 0;
    while (this.totalBytes > this.maxTotalBytes && idx < allEntries.length) {
      const { sessionId, snap } = allEntries[idx++]!;
      const list = this.perSession.get(sessionId);
      if (list) {
        const pos = list.indexOf(snap);
        if (pos >= 0) list.splice(pos, 1);
        if (list.length === 0) this.perSession.delete(sessionId);
      }
      this.byId.delete(snap.id);
      this.totalBytes -= snap.bytes;
    }
  }
}

// ─── Diff helper · line-oriented ──────────────────────────────────

export interface SnapshotDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly sameLines: number;
}

/** Line-diff two snapshots' screens. Not Myers — just set-based
 *  added/removed + count of common lines. Cheap and useful for the
 *  LLM tool's "what changed between two captures" story. */
export function diffSnapshots(a: TtySnapshot, b: TtySnapshot): SnapshotDiff {
  const linesA = a.screen.split('\n');
  const linesB = b.screen.split('\n');
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const added: string[] = [];
  const removed: string[] = [];
  let same = 0;
  for (const line of linesB) {
    if (!setA.has(line)) added.push(line);
    else same++;
  }
  for (const line of linesA) {
    if (!setB.has(line)) removed.push(line);
  }
  return { added, removed, sameLines: same };
}

/** Process-wide singleton. Tests build fresh instances via `new`. */
export const defaultTtySnapshotStore = new TtySnapshotStore();
