// ── Phase C (Capture Fabric · video tool exposure) — Recording store ──
//
// LLM-callable Start/Stop recording needs a process-wide handle ↔ id
// map so the LLM can `StartRecording → recordingId → StopRecording` in
// any order across turns. Tools are stateless; the store is the state.
//
// Pure in-memory map. Persistence (artifact path on disk) is the host's
// responsibility — this module returns the asciicast/gif/mp4 buffer +
// caller decides where to write.
//
// Eviction: stopped recordings are kept until `forget(id)` is called.
// Hosts may run a periodic GC over `list()` to drop stale ones.

import type { RecorderHandle, RecorderStatus } from './types.js';

export type RecordingEncoder = 'asciicast' | 'gif' | 'mp4';

export interface RecordingEntry {
  readonly id: string;
  readonly handle: RecorderHandle;
  readonly encoder: RecordingEncoder;
  readonly source: {
    readonly windowId?: string;
    readonly paneId?: string;
    readonly surfaceLabel?: string;
  };
  readonly startedAt: number;
  /** Set when stop() was called. */
  stoppedAt?: number;
  /** Optional artifact path written by host. */
  artifactPath?: string;
}

export interface RecordingStore {
  start(opts: {
    handle: RecorderHandle;
    encoder: RecordingEncoder;
    source: RecordingEntry['source'];
    now?: () => number;
  }): RecordingEntry;
  get(id: string): RecordingEntry | null;
  list(filter?: { status?: RecorderStatus }): readonly RecordingEntry[];
  /** Mark an entry as stopped. Returns the entry, or null if missing. */
  markStopped(id: string, opts?: { artifactPath?: string; now?: () => number }): RecordingEntry | null;
  /** Drop an entry from the store. Idempotent. */
  forget(id: string): boolean;
  size(): number;
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `rec-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

export function createRecordingStore(): RecordingStore {
  const entries = new Map<string, RecordingEntry>();
  return {
    start({ handle, encoder, source, now }) {
      const ts = (now ?? Date.now)();
      const id = nextId();
      const entry: RecordingEntry = {
        id,
        handle,
        encoder,
        source,
        startedAt: ts,
      };
      entries.set(id, entry);
      return entry;
    },
    get(id) {
      return entries.get(id) ?? null;
    },
    list(filter) {
      const all = Array.from(entries.values());
      if (!filter?.status) return all;
      return all.filter((e) => e.handle.status === filter.status);
    },
    markStopped(id, opts) {
      const entry = entries.get(id);
      if (!entry) return null;
      const ts = (opts?.now ?? Date.now)();
      const updated: RecordingEntry = {
        ...entry,
        stoppedAt: ts,
        ...(opts?.artifactPath !== undefined ? { artifactPath: opts.artifactPath } : {}),
      };
      entries.set(id, updated);
      return updated;
    },
    forget(id) {
      return entries.delete(id);
    },
    size() {
      return entries.size;
    },
  };
}

/** Singleton store — host wires tools to this instance. Test-only
 *  reset via `__resetRecordingStoreForTest`. */
let _singleton: RecordingStore | null = null;
export function getRecordingStore(): RecordingStore {
  if (!_singleton) _singleton = createRecordingStore();
  return _singleton;
}
export function __resetRecordingStoreForTest(): void {
  _singleton = createRecordingStore();
}
