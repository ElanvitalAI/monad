// W5 Y3 · Patcher input source aggregator.
// Cf. ROADMAP-background-reasoning §3.2.
// PatcherBridge (W5 U4) is the canonical live source; additional file
// sources (debug log · skill runs · session transcripts · mission audit
// · workflow runs · morning digest) load via injected JSONL readers so
// Y3 stays decoupled from filesystem layout.

import type { PatcherBridge, PatcherBridgeInput } from '../user-intent/sinks/patcher-bridge.js';

export type PatcherInputKind =
  | 'user_intent'        // PatcherBridge live stream (U4)
  | 'jsonl_log'          // ~/.elanous/debug-log, intent-motion-feedback, ambient-triggers
  | 'skill_results'      // ~/.elanous/skill-runs/<id>/*
  | 'session_transcripts'
  | 'mission_audit'
  | 'workflow_runs'
  | 'morning_digest';

export interface PatcherInputItem {
  kind: PatcherInputKind;
  /** Free-form payload. user_intent kind carries PatcherBridgeInput; file
   *  kinds carry { path, line, lineNo } or { path, json }. */
  payload: unknown;
  /** Source-attached timestamp (ms epoch). */
  at: number;
}

export interface FileSourceReader {
  kind: Exclude<PatcherInputKind, 'user_intent'>;
  /** Drain returns items since the last call and resets internal cursor. */
  drain(): Promise<PatcherInputItem[]>;
}

export interface PatcherInputSourcesDeps {
  bridge: PatcherBridge;
  readers?: FileSourceReader[];
}

export class PatcherInputSources {
  private readonly bridge: PatcherBridge;
  private readonly readers: FileSourceReader[];

  constructor(deps: PatcherInputSourcesDeps) {
    this.bridge = deps.bridge;
    this.readers = deps.readers ?? [];
  }

  /** Single drain across every source. Returns merged item list sorted by `at`. */
  async drainAll(): Promise<PatcherInputItem[]> {
    const live = this.bridge.drainBatch();
    const liveItems: PatcherInputItem[] = live.map((b: PatcherBridgeInput): PatcherInputItem => ({
      kind: 'user_intent',
      payload: b,
      at: Date.parse(b.event.ts) || 0,
    }));

    const fileBatches = await Promise.all(this.readers.map((r) => r.drain().catch(() => [])));
    const all: PatcherInputItem[] = [...liveItems];
    for (const batch of fileBatches) all.push(...batch);
    all.sort((a, b) => a.at - b.at);
    return all;
  }

  /** Lightweight count — does not drain. Useful for trigger threshold checks. */
  pendingUserIntent(): number {
    return this.bridge.pendingCount();
  }

  registerReader(reader: FileSourceReader): void {
    this.readers.push(reader);
  }
}
