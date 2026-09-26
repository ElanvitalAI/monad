// M1 PR 1 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// carrier-agnostic Feedback Envelope substrate.
//
// TUI / PWA / iOS 세 surface 가 같은 dev-피드백 stream (search · edit ·
// debug · agent-status · tool progress) 을 자기 native renderer 로
// hydrate 하기 위한 단일 wire 단위. ACP WebSocket · stdio · APNs · Mesh
// 2 어디로 흘러도 같은 envelope 이 round-trip.
//
// 본 모듈은 **순수 substrate**: tool-runtime / dashboard / acp / pwa 어떤
// 도메인 코드도 import 안 함. `message-block.ts` 의 blockId helpers 를
// 재사용해 두 substrate 의 merge key 가 isomorphic 함을 보장.
//
// 후속 (PLAN §6.2 P3-envelope-merge) 에서 `MessageBlockKind` 와
// `FeedbackKind` union 의 통합 RFC 시 envelope schema 가 backward-compat
// 보장을 책임 — `envelopeVersion: 1` 은 kind union expansion 만 허용.

import { debug } from '../debug/log.js';

// ── Kind union (8-way) ───────────────────────────────────────────────
//
// PLAN §2.3 schema. 새 kind 추가는 v1 호환 — 단, 모든 renderer (TUI ANSI
// formatter · PWA component map · iOS text fallback) 가 `default` case
// 에서 `asciiFallback` 으로 안전하게 degrade 하도록 보장.

export type FeedbackKind =
  | 'tool.progress' //     bash stdout tail · http body chunk · large file read
  | 'tool.diff' //         edit/write diff (intra-line word-diff)
  | 'tool.search-hit' //   structured Grep / OmniSearch hit (file/line/snippet)
  | 'agent.status' //      AgentStatusStore mirror (running/queued/error/done)
  | 'agent.thinking' //    ThinkingHandle update (msg / metrics)
  | 'agent.plan' //        plan block (kind === 'plan' from MessageBlockKind)
  | 'debug.line' //        mirrored debug.log entry (gated · category-filtered)
  | 'perf.tick' //         perf-counter snapshot (Phase 2 · P2-perf-tick)
  | 'hud.segment' //       TUI HUD bar segment (process-wide state · key→value
  //                       upsert · phase=update set/replace · phase=end clear).
  //                       PLAN-chat-hud-multi-surface-port-2026-05-13 §2.3.
  | 'mission.update' //    cascade-zyu W8-A Phase 4 (2026-05-14) — iOS Live
  //                       Activity / Dynamic Island Mission render. payload =
  //                       MissionUpdatePayload (op: start/update/end · title/
  //                       status/progress/eta + missionId/emoji immutable).
  //                       PLAN-cascade-zyu-w8a-camp-d-ios-ui-2026-05-14 §3.1.
  | 'agent.chat-stream' // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase A —
  //                       LLM 의 agent_message_chunk text 가 chat-targeted bubble
  //                       으로 stream. iOS ChatView 가 thought/announce/done 3 role
  //                       으로 render. agent.status (HUD) 와 별개 path.
  //                       (HITL ask_user_question 은 ACP bridge `elanous/ask/*` +
  //                       iOS ACPClient.pendingAskQuestion sheet 으로 이미 wire —
  //                       agent.ask envelope kind 신설 불필요.)
  | 'media.image' //       MCP / generation 결과 그림. src + mediaType, 선택적 alt.
  | 'media.video' //       MCP / generation 결과 동영상. src, 선택적 posterSrc.
  | 'media.job'; //        MCP generation job 진행. jobId + mediaKind + status.

export type FeedbackPhase = 'start' | 'delta' | 'update' | 'end';

/** Low-frequency progress and planning events that remain observable with file-only logging. */
export function shouldPersistEnvelopeObservation(kind: FeedbackKind): boolean {
  return kind === 'agent.plan'
    || kind === 'mission.update'
    || kind === 'tool.progress'
    || kind === 'tool.diff'
    || kind === 'agent.status'
    || kind === 'media.image'
    || kind === 'media.video'
    || kind === 'media.job';
}

// ── Per-kind payload types ───────────────────────────────────────────
//
// 각 payload 는 `asciiFallback` 와 별개로 **typed** 정보를 가져 PWA/iOS
// native renderer 가 풍부한 위젯을 hydrate. ASCII 만 가지는 dumb renderer
// 는 envelope.asciiFallback 으로 fallback.

export interface ToolProgressPayload {
  /** stdout · stderr · http-body 등 stream source 식별. PWA 가 색깔
   *  분기. */
  stream: 'stdout' | 'stderr' | 'http' | 'generic';
  /** 한 envelope 안의 line 청크. 16ms tick 또는 N-line coalescing 으로
   *  emit 측에서 묶음. */
  lines: string[];
  /** delta 의 누적 byte (UI progress bar 용 · optional). */
  bytesSoFar?: number;
  /** 종료 시 exit code (phase=end 일 때만). */
  exitCode?: number;
}

export interface DiffHunkLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffHunkLine[];
}

export interface ToolDiffPayload {
  filePath: string;
  /** Shiki language hint (PWA syntax-highlight 용). missing → plain. */
  language?: string;
  hunks: DiffHunk[];
}

export interface SearchHit {
  filePath: string;
  line: number;
  column?: number;
  /** 매칭 line 의 raw text (PWA 가 highlight 직접). */
  snippet: string;
  /** pre/post 컨텍스트 (1줄 씩 권장 · empty 가능). */
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface ToolSearchHitPayload {
  query: string;
  hits: SearchHit[];
  /** 누적 hit count (UI count badge 용 · phase=delta 에서 증가). */
  accumCount: number;
  /** 검색이 끝났는지 (phase=end 와 별개로 server-side truncation 표시). */
  truncated?: boolean;
}

export interface AgentStatusPayload {
  agentId: string;
  status: 'running' | 'queued' | 'error' | 'done';
  /** 마지막 이벤트 텍스트 (HUD pulse 옆 hint). */
  lastEvent?: string;
}

export interface AgentThinkingPayload {
  /** ThinkingHandle.update 의 msg field. */
  msg?: string;
  metrics?: {
    elapsedMs?: number;
    tokenCount?: number;
    thoughtMs?: number;
  };
}

export interface AgentPlanPayload {
  /** plan ref (makePlanBlockId 의 input 과 일치). */
  ref: string;
  steps: Array<{
    text: string;
    status: 'pending' | 'in-progress' | 'done' | 'skipped';
  }>;
  /** 현재 진행 중 step 의 0-based index (없으면 미시작 / 완료). */
  activeIndex?: number;
}

export interface DebugLinePayload {
  /** debug.log 의 첫 인자 — kebab-case `<subsystem>.<event>`. */
  category: string;
  /** debug.log 의 두 번째 인자. */
  event: string;
  /** 세 번째 인자 (compacted · 256-char string / 6-item array / depth 4). */
  data?: unknown;
  /** debug.log emit 시각 (envelope.emittedAt 와 다를 수 있음 — mirror lag). */
  loggedAt: number;
}

export interface PerfTickPayload {
  /** P2-perf-tick 에서 정의. v1 에서는 free-form. */
  metric: string;
  value: number;
  unit?: string;
}

// PLAN-chat-hud-multi-surface-port-2026-05-13 §2.3 — TUI HUD bar segments
// (`src/panes/hud.ts`) → cross-surface state. HUD 는 **state map** (key →
// segment) 이라 phase semantics 가 turn-scoped envelope 와 다름:
//   - phase='update'  값 set/replace
//   - phase='end'     key clear (segment 제거)
//   - phase='start'/'delta' 미사용 (HUD 는 cumulative buffer 가 아닌 latest-wins)
//
// blockId 컨벤션: `${sessionId}:hud:${key}` — segment key 가 stable upsert
// merge id. sessionId 는 wire 식별자 (HUD state 자체는 process-wide
// singleton — multi-tab/multi-session PWA 가 같은 HUD 공유).
export interface HudSegmentPayload {
  /** Stable segment key — `setSegment(hud, key, ...)` 의 key 와 1:1.
   *  TUI 와 동일 어휘 사용 (예: 'reasoning' · 'ssh-remote' · 'token-gauge'). */
  key: string;
  /** Pre-formatted plain-text value (ANSI 코드는 source-side 에서 strip —
   *  M3 mirror 책임). PWA renderer 는 `tone` 으로 색상 정보 받음. */
  value: string;
  /** Sort order — TUI 의 priority 와 동일. Default 50. */
  priority?: number;
  /** Renderer 색상/스타일 hint. ANSI 코드 우회 carrier. */
  tone?: 'normal' | 'warn' | 'danger' | 'success' | 'info' | 'muted';
  /** Optional leading glyph (✦ ● ↯ 🎙 🌐 등). emoji 또는 lucide icon 이름. */
  glyph?: string;
}

// ── Mission payload (W8-A Phase 4 · 2026-05-14) ──────────────────────
//
// iOS Live Activity / Dynamic Island Mission render. iOS-side mirror =
// `apps/ios/ElanousiOS/ElanousiOS/Shared/Feedback/FeedbackEnvelope.swift` 의
// `MissionUpdatePayload` (struct · 같은 field name). MissionContentState
// 의 5-field (Q1=B) 가 본 payload 안에 직접 들어감 — Live Activity 가 본
// payload 받으면 ActivityKit `Activity.update(ActivityContent(state:))` 로 swap.
//
// `op` discriminator: 'start' (Activity.request) · 'update' (Activity.update)
// · 'end' (Activity.end). Phase 의 의미는 envelope.phase 와 별개 — 본
// payload 는 lifecycle 액션을, envelope.phase 는 stream timing (start/delta/
// update/end) 를 표현.

// ── Autopilot bidirectional payloads (Phase A · 2026-05-20) ──────────
//
// PLAN-autopilot-terminal-driving-2026-05-20 v2 §3.1 — 기존 43 PR cascade
// (elanous-builtin autopilot · terminal agency) 가 LLM → terminal 단방향
// + tool_call agency 까지 wire. 본 phase 가 추가하는 "chat 양방향" 의 2 wire:
//   - agent.chat-stream  LLM 자발 chat push (thought/announce/done)
//   - agent.ask          HITL question (사용자 응답 required)
// 이 둘이 기존 agent.status (HUD) · agent.plan (HUD) 와 별개 path —
// iOS ChatView 가 native message bubble 로 render.

export interface AgentChatStreamPayload {
  /** LLM 의 reasoning / thought / announce text. agent_message_chunk 의
   *  per-iteration 누적 또는 delta. iOS 가 blockId merge 로 bubble 갱신. */
  text: string;
  /** Bubble visual style 결정. 'thought' = inline thinking-style · 'announce'
   *  = normal assistant message · 'done' = final summary (loop 종료 시점). */
  role: 'thought' | 'announce' | 'done';
  /** Loop iteration index (0-based · UI debug label 용). */
  iteration?: number;
}

export interface MediaImagePayload {
  src: string;
  mediaType: string;
  alt?: string;
}

export interface MediaVideoPayload {
  src: string;
  posterSrc?: string;
}

export interface MediaJobPayload {
  jobId: string;
  mediaKind: 'image' | 'video';
  status: string;
  resultUrl?: string;
  model?: string;
  /** Original generation text retained so consumers can seed a follow-up job. */
  prompt?: string;
}

export interface MissionUpdatePayload {
  /** Mission lifecycle 동안 immutable. Activity Attributes 의 missionId 와 일치. */
  missionId: string;
  /** Lock Screen / Dynamic Island 상단 표시. */
  title: string;
  /** 4-state. iOS `MissionStatus.rawValue` 와 정합. */
  status: 'running' | 'waiting' | 'done' | 'error';
  /** 0.0 … 1.0. omit = indeterminate. */
  progress?: number;
  /** ISO8601 with fractional seconds (RFC3339 milli). omit = no estimate. */
  etaIso?: string;
  /** Mission type emoji. omit = iOS default ('🚀'). immutable per missionId. */
  emoji?: string;
  /** Live Activity lifecycle action. */
  op: 'start' | 'update' | 'end';
}

// ── Discriminated envelope ───────────────────────────────────────────
//
// payload 타입 narrowing 은 `kind` 로 — TUI / PWA 양쪽 component map 에서
// switch(kind) 가 exhaustive 하도록 보장.

export interface FeedbackEnvelopeBase {
  /** schema 호환 게이트. v2 로 올라가면 wire 호환 깨짐 — kind union 만
   *  확장하는 한 v1 유지. */
  readonly envelopeVersion: 1;
  readonly sessionId: string;
  /** Stable merge key. `makeToolCallBlockId` 등 message-block helpers 와
   *  isomorphic — 두 substrate 의 같은 logical block 이 같은 id. */
  readonly blockId: string;
  /** tool.* kind 에서 부모 tool-call 의 toolCallId (없는 kind 는 omit). */
  readonly parentToolCallId?: string;
  readonly phase: FeedbackPhase;
  /** ms epoch (TUI clock). 직렬화/역직렬화 round-trip 에 안전. */
  readonly emittedAt: number;
  /** per-blockId monotonic. gap (next - prev > 1) → renderer 가 full
   *  update 요청 가능. SeqTracker 가 발급. */
  readonly seq: number;
  /** dumb renderer (iOS text · CLI dump · log mirror) 를 위한 pre-rendered
   *  ANSI / plain 라인. always populated — empty array 가 명시적
   *  "no ascii". */
  readonly asciiFallback: readonly string[];
}

export type FeedbackEnvelope =
  | (FeedbackEnvelopeBase & { kind: 'tool.progress'; payload: ToolProgressPayload })
  | (FeedbackEnvelopeBase & { kind: 'tool.diff'; payload: ToolDiffPayload })
  | (FeedbackEnvelopeBase & { kind: 'tool.search-hit'; payload: ToolSearchHitPayload })
  | (FeedbackEnvelopeBase & { kind: 'agent.status'; payload: AgentStatusPayload })
  | (FeedbackEnvelopeBase & { kind: 'agent.thinking'; payload: AgentThinkingPayload })
  | (FeedbackEnvelopeBase & { kind: 'agent.plan'; payload: AgentPlanPayload })
  | (FeedbackEnvelopeBase & { kind: 'debug.line'; payload: DebugLinePayload })
  | (FeedbackEnvelopeBase & { kind: 'perf.tick'; payload: PerfTickPayload })
  | (FeedbackEnvelopeBase & { kind: 'hud.segment'; payload: HudSegmentPayload })
  | (FeedbackEnvelopeBase & { kind: 'mission.update'; payload: MissionUpdatePayload })
  | (FeedbackEnvelopeBase & { kind: 'agent.chat-stream'; payload: AgentChatStreamPayload })
  | (FeedbackEnvelopeBase & { kind: 'media.image'; payload: MediaImagePayload })
  | (FeedbackEnvelopeBase & { kind: 'media.video'; payload: MediaVideoPayload })
  | (FeedbackEnvelopeBase & { kind: 'media.job'; payload: MediaJobPayload });

// ── Validation gates ─────────────────────────────────────────────────

export const FEEDBACK_KINDS: readonly FeedbackKind[] = [
  'tool.progress',
  'tool.diff',
  'tool.search-hit',
  'agent.status',
  'agent.thinking',
  'agent.plan',
  'debug.line',
  'perf.tick',
  'hud.segment',
  'mission.update',
  'agent.chat-stream',
  'media.image',
  'media.video',
  'media.job',
] as const;

const FEEDBACK_KIND_SET: ReadonlySet<string> = new Set(FEEDBACK_KINDS);
const FEEDBACK_PHASE_SET: ReadonlySet<string> = new Set(['start', 'delta', 'update', 'end']);

/** Type guard for run-time validation (wire read · cross-process). */
export function isFeedbackEnvelope(value: unknown): value is FeedbackEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.envelopeVersion !== 1) return false;
  if (typeof v.sessionId !== 'string' || !v.sessionId) return false;
  if (typeof v.blockId !== 'string' || !v.blockId) return false;
  if (typeof v.kind !== 'string' || !FEEDBACK_KIND_SET.has(v.kind)) return false;
  if (typeof v.phase !== 'string' || !FEEDBACK_PHASE_SET.has(v.phase)) return false;
  if (typeof v.emittedAt !== 'number') return false;
  if (typeof v.seq !== 'number' || v.seq < 0) return false;
  if (!Array.isArray(v.asciiFallback)) return false;
  if (v.payload === undefined || v.payload === null) return false;
  if (v.parentToolCallId !== undefined && typeof v.parentToolCallId !== 'string') return false;
  return true;
}

// ── Serialization ────────────────────────────────────────────────────
//
// 단순 JSON — readonly array 가 wire round-trip 후 mutable 로 돌아오지만
// type level 만 readonly 유지. Wire 측 invariant 위반은 isFeedbackEnvelope
// gate 에서 reject.

export function serializeEnvelope(env: FeedbackEnvelope): string {
  return JSON.stringify(env);
}

export function parseEnvelope(wire: string): FeedbackEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(wire);
  } catch (err) {
    throw new Error(
      `parseEnvelope: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isFeedbackEnvelope(parsed)) {
    throw new Error('parseEnvelope: schema mismatch — not a valid FeedbackEnvelope v1');
  }
  return parsed;
}

// ── Seq tracker ──────────────────────────────────────────────────────
//
// emit 측: 한 blockId 의 연속 envelope 에 monotonic seq 발급.
// receive 측: 같은 blockId 의 incoming seq 가 prev+1 인지 검증.
//            gap 감지 → renderer 가 phase: 'update' full snapshot 재요청.
//
// blockId scope 로 격리 — 다른 block 의 seq 는 독립. dispose() 로 메모리
// 정리 (session reset 시).

export interface SeqTracker {
  /** Next seq for the given blockId. monotonic 1, 2, 3, ... */
  next(blockId: string): number;
  /** Peek last issued seq for the blockId (0 if never issued). */
  peek(blockId: string): number;
  /** Drop seq state for blockId — session reset · block dispose 시. */
  forget(blockId: string): void;
  /** Drop all state. session-wide reset. */
  clear(): void;
}

export function createSeqTracker(): SeqTracker {
  const lastSeqByBlockId = new Map<string, number>();
  return {
    next(blockId) {
      const prev = lastSeqByBlockId.get(blockId) ?? 0;
      const nextSeq = prev + 1;
      lastSeqByBlockId.set(blockId, nextSeq);
      return nextSeq;
    },
    peek(blockId) {
      return lastSeqByBlockId.get(blockId) ?? 0;
    },
    forget(blockId) {
      lastSeqByBlockId.delete(blockId);
    },
    clear() {
      lastSeqByBlockId.clear();
    },
  };
}

export type GapResult =
  | { status: 'ok'; prev: number; current: number }
  | { status: 'duplicate'; prev: number; current: number }
  | { status: 'gap'; prev: number; current: number; missing: number };

/** Receive-side gap detector. emit 측 SeqTracker 와 다른 인스턴스 —
 *  receiver 는 last *observed* seq 만 추적. duplicate (network retry) 와
 *  gap (drop) 을 구분해 호출자가 dedupe / full-snapshot 요청 결정. */
export interface GapDetector {
  observe(blockId: string, incomingSeq: number): GapResult;
  forget(blockId: string): void;
  clear(): void;
}

export function createGapDetector(): GapDetector {
  const observedByBlockId = new Map<string, number>();
  return {
    observe(blockId, incomingSeq) {
      const prev = observedByBlockId.get(blockId) ?? 0;
      if (incomingSeq <= prev) {
        return { status: 'duplicate', prev, current: incomingSeq };
      }
      if (incomingSeq === prev + 1) {
        observedByBlockId.set(blockId, incomingSeq);
        return { status: 'ok', prev, current: incomingSeq };
      }
      observedByBlockId.set(blockId, incomingSeq);
      return {
        status: 'gap',
        prev,
        current: incomingSeq,
        missing: incomingSeq - prev - 1,
      };
    },
    forget(blockId) {
      observedByBlockId.delete(blockId);
    },
    clear() {
      observedByBlockId.clear();
    },
  };
}

// ── Factory helper ───────────────────────────────────────────────────
//
// 호출자가 raw object literal 을 채우는 대신 helper 를 거치면 (1) phase /
// asciiFallback 기본값 보장, (2) seq 발급, (3) emittedAt 자동, (4) debug
// trace. 모든 emit bridge (PLAN §4) 가 이 helper 를 통해 envelope 발행.

export interface MakeEnvelopeInput<Kind extends FeedbackKind, Payload> {
  kind: Kind;
  sessionId: string;
  blockId: string;
  phase: FeedbackPhase;
  payload: Payload;
  parentToolCallId?: string;
  /** dumb-renderer fallback. 안 주면 빈 배열 — 호출자가 명시적으로
   *  "no ascii" 표현. */
  asciiFallback?: readonly string[];
  /** test / replay 시 clock injection. 기본 Date.now(). */
  now?: () => number;
}

export function makeEnvelope<Kind extends FeedbackKind, Payload>(
  input: MakeEnvelopeInput<Kind, Payload>,
  seqTracker: SeqTracker,
): FeedbackEnvelope {
  const seq = seqTracker.next(input.blockId);
  const emittedAt = (input.now ?? Date.now)();
  const env = {
    envelopeVersion: 1 as const,
    sessionId: input.sessionId,
    blockId: input.blockId,
    parentToolCallId: input.parentToolCallId,
    kind: input.kind,
    phase: input.phase,
    emittedAt,
    seq,
    payload: input.payload,
    asciiFallback: input.asciiFallback ?? [],
  } as FeedbackEnvelope;

  if (debug.enabled || shouldPersistEnvelopeObservation(input.kind)) {
    debug.log('feedback.envelope.emit', input.blockId, {
      kind: input.kind,
      phase: input.phase,
      seq,
      asciiLines: env.asciiFallback.length,
      parent: input.parentToolCallId,
    });
  }
  return env;
}
