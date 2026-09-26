// ── M3 (Phase 4 Bundle 4 hero) — Embodied multi-agent unified channel timeline ──
//
// HANDOFF Phase 4 / ROADMAP §7 M3: "Embodied multi-agent 통일 channel".
// 모든 multi-agent collaboration (mesh debate, ACP subagents, voice HITL,
// PFC reverse-feedback, screenshot capture) 을 *한 timeline* 으로 통합 +
// 재생 가능한 형태로 기록. Phase 4 의 hero — 모든 자율적 활동의 audit
// trail + replay UI 의 substrate.
//
// 6 entry kinds:
//   - shell-spawn / shell-end  (T1 / A1 / C1 ↔ ShellRegistry)
//   - posture-change            (substrate)
//   - debate-round              (A3)
//   - hitl-prompt / hitl-answer (M2)
//   - voice-utterance           (V1, X7, M4)
//   - capture-frame             (X4, X5, X6)
//   - external-rpc-call         (A1, B, M4)
//
// 모든 entry 가 통일된 shape — replay UI / audit query 가 same code path.

export type EmbodiedEntryKind =
  | 'shell-spawn'
  | 'shell-end'
  | 'posture-change'
  | 'debate-round'
  | 'hitl-prompt'
  | 'hitl-answer'
  | 'voice-utterance'
  | 'capture-frame'
  | 'external-rpc-call'
  | 'note';

export interface EmbodiedTimelineEntry {
  readonly id: string;
  readonly kind: EmbodiedEntryKind;
  /** Wall-clock (ISO). */
  readonly at: string;
  /** Monotonic time since timeline start (ms). */
  readonly atMs: number;
  /** Free-form actor — agent id / persona / 'user' / 'elanous'. */
  readonly actor: string;
  /** Optional channel context (Discord channel / TUI session / Telegram chat). */
  readonly channelId?: string;
  /** Cross-referenced shellId when relevant. */
  readonly shellId?: string;
  /** Entry-kind-specific payload. */
  readonly payload: Record<string, unknown>;
  /** Optional cross-link — `relatesTo` 다른 entry id (예: hitl-answer → hitl-prompt). */
  readonly relatesTo?: string;
}

export interface EmbodiedTimelineFilter {
  readonly kinds?: readonly EmbodiedEntryKind[];
  readonly actor?: string;
  readonly channelId?: string;
  readonly shellId?: string;
  /** Inclusive ms range from timeline start. */
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
}

export interface EmbodiedTimelineSummary {
  readonly totalEntries: number;
  readonly perKind: Record<EmbodiedEntryKind, number>;
  readonly perActor: Record<string, number>;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface EmbodiedTimeline {
  /** Append a new entry. id auto-generated when omitted. Returns the id. */
  append(entry: Omit<EmbodiedTimelineEntry, 'id' | 'at' | 'atMs'> & { id?: string }): string;
  /** Snapshot — chronological. */
  list(filter?: EmbodiedTimelineFilter): readonly EmbodiedTimelineEntry[];
  /** Summary statistics. */
  summary(): EmbodiedTimelineSummary;
  /** Pure helpers — group entries by some dimension. */
  groupByActor(): Record<string, readonly EmbodiedTimelineEntry[]>;
  groupByKind(): Record<EmbodiedEntryKind, readonly EmbodiedTimelineEntry[]>;
  /** Mark timeline end (calls won't append further). Idempotent. */
  finish(): EmbodiedTimelineSummary;
  /** Diagnostic. */
  size(): number;
}

export interface EmbodiedTimelineOpts {
  /** Hard cap on entries (drops oldest beyond). Default 5000. */
  readonly cap?: number;
  /** Test seam — defaults to Date.now (ms) and new Date.toISOString. */
  readonly now?: () => number;
  readonly isoNow?: () => string;
  /** Test seam — defaults to crypto.randomUUID. */
  readonly newId?: () => string;
}

const DEFAULT_CAP = 5000;

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmbodiedTimeline(
  opts: EmbodiedTimelineOpts = {},
): EmbodiedTimeline {
  const cap = opts.cap ?? DEFAULT_CAP;
  const now = opts.now ?? Date.now;
  const isoNow = opts.isoNow ?? (() => new Date().toISOString());
  const newId = opts.newId ?? defaultId;

  const startedAt = isoNow();
  const startMs = now();
  const entries: EmbodiedTimelineEntry[] = [];
  let finished: EmbodiedTimelineSummary | null = null;

  const appendInternal = (
    e: Omit<EmbodiedTimelineEntry, 'id' | 'at' | 'atMs'> & { id?: string },
  ): string => {
    if (finished) return '';
    const entry: EmbodiedTimelineEntry = {
      id: e.id ?? newId(),
      kind: e.kind,
      at: isoNow(),
      atMs: now() - startMs,
      actor: e.actor,
      ...(e.channelId !== undefined ? { channelId: e.channelId } : {}),
      ...(e.shellId !== undefined ? { shellId: e.shellId } : {}),
      payload: e.payload,
      ...(e.relatesTo !== undefined ? { relatesTo: e.relatesTo } : {}),
    };
    entries.push(entry);
    while (entries.length > cap) entries.shift();
    return entry.id;
  };

  return {
    append(e) {
      return appendInternal(e);
    },

    list(filter = {}) {
      const limit = filter.limit ?? entries.length;
      const fromMs = filter.fromMs ?? -Infinity;
      const toMs = filter.toMs ?? Infinity;
      const out: EmbodiedTimelineEntry[] = [];
      for (const e of entries) {
        if (filter.kinds && !filter.kinds.includes(e.kind)) continue;
        if (filter.actor && e.actor !== filter.actor) continue;
        if (filter.channelId && e.channelId !== filter.channelId) continue;
        if (filter.shellId && e.shellId !== filter.shellId) continue;
        if (e.atMs < fromMs || e.atMs > toMs) continue;
        out.push(e);
        if (out.length >= limit) break;
      }
      return out;
    },

    summary() {
      const perKind: Record<EmbodiedEntryKind, number> = {
        'shell-spawn': 0, 'shell-end': 0, 'posture-change': 0,
        'debate-round': 0, 'hitl-prompt': 0, 'hitl-answer': 0,
        'voice-utterance': 0, 'capture-frame': 0,
        'external-rpc-call': 0, 'note': 0,
      };
      const perActor: Record<string, number> = {};
      for (const e of entries) {
        perKind[e.kind] += 1;
        perActor[e.actor] = (perActor[e.actor] ?? 0) + 1;
      }
      return {
        totalEntries: entries.length,
        perKind,
        perActor,
        durationMs: now() - startMs,
        startedAt,
      };
    },

    groupByActor() {
      const out: Record<string, EmbodiedTimelineEntry[]> = {};
      for (const e of entries) {
        if (!out[e.actor]) out[e.actor] = [];
        out[e.actor]!.push(e);
      }
      return out;
    },

    groupByKind() {
      const out: Record<EmbodiedEntryKind, EmbodiedTimelineEntry[]> = {
        'shell-spawn': [], 'shell-end': [], 'posture-change': [],
        'debate-round': [], 'hitl-prompt': [], 'hitl-answer': [],
        'voice-utterance': [], 'capture-frame': [],
        'external-rpc-call': [], 'note': [],
      };
      for (const e of entries) {
        out[e.kind].push(e);
      }
      return out;
    },

    finish() {
      if (finished) return finished;
      finished = {
        totalEntries: entries.length,
        perKind: this.summary().perKind,
        perActor: this.summary().perActor,
        durationMs: now() - startMs,
        startedAt,
        endedAt: isoNow(),
      };
      return finished;
    },

    size() {
      return entries.length;
    },
  };
}

// ── Replay helpers ──────────────────────────────────────────────────

export interface ReplayCallbacks {
  onEntry: (entry: EmbodiedTimelineEntry) => void | Promise<void>;
  onProgress?: (currentMs: number, totalMs: number) => void;
  onComplete?: () => void;
}

export interface ReplayOpts {
  /** Speed multiplier — 1.0 = realtime, 0 = no delay (replay-as-fast). */
  readonly speed?: number;
  /** Resume from a specific timestamp (ms). */
  readonly fromMs?: number;
  /** Optional cancel signal. */
  readonly signal?: AbortSignal;
  /** Test seam — defaults to setTimeout. */
  readonly delay?: (ms: number) => Promise<void>;
}

function defaultDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Replay timeline entries with timing preserved. `speed=1` plays back at
 * realtime; `speed=0` replays as fast as possible. Useful for audit
 * UI playback ("어제 alice 의 작업 어떻게 됐는지 다시 보기").
 */
export async function replayTimeline(
  entries: readonly EmbodiedTimelineEntry[],
  callbacks: ReplayCallbacks,
  opts: ReplayOpts = {},
): Promise<void> {
  const speed = opts.speed ?? 1;
  const fromMs = opts.fromMs ?? 0;
  const delayFn = opts.delay ?? defaultDelay;
  const filtered = entries.filter((e) => e.atMs >= fromMs);
  const totalMs = filtered.length > 0 ? filtered[filtered.length - 1]!.atMs : 0;
  let lastMs = filtered.length > 0 ? filtered[0]!.atMs : 0;

  for (const entry of filtered) {
    if (opts.signal?.aborted) return;
    const wait = speed > 0 ? (entry.atMs - lastMs) / speed : 0;
    if (wait > 0) await delayFn(wait);
    if (opts.signal?.aborted) return;
    await callbacks.onEntry(entry);
    callbacks.onProgress?.(entry.atMs, totalMs);
    lastMs = entry.atMs;
  }
  callbacks.onComplete?.();
}
