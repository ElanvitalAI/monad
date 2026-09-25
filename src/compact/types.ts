// ── Wave 2 · compact pipeline types ──────────────────────────────────
//
// Shared shape for the no-LLM (Layer 1+2) and LLM (Layer 3, Wave 4)
// stages. The pipeline takes `LLMMessage[]` in and returns
// `LLMMessage[]` out — never mutates the input array.

import type { LLMMessage } from '../llm.js';

/** Tunables exposed to user-config + slash invocations. Defaults
 *  follow the 3-ref RESEARCH:
 *  - `preserveLastN`     — Claude/Gemini: protect recent turns.
 *  - `microcompactAgeThreshold` — Claude `TIME_BASED_MC_CONFIG`
 *    inspired; clear tool-result content older than N turns ago.
 *  - `toolOutputCharBudget`     — Gemini `truncateHistoryToBudget`
 *    50K char ceiling per individual function response.
 *  - `toolOutputTailLines`      — Gemini: keep the last 30 lines
 *    after pruning, replacing the head with a file pointer.
 *  - `archiveEnabled` / `archiveDir` — JSONL persistence of cleared
 *    content under `~/.monad/compact-archive/<sessionId>.jsonl`. */
export interface CompactPolicy {
  preserveLastN: number;
  /** ★ 핵심 앵커 보존(2026-07-21) — Layer 3 요약이 뭉개면 안 되는 **맨 앞 앵커**
   *  (페이즈 프롬프트 / WM / premise = 첫 user 메시지) 를 pin 하는 개수. L3 요약
   *  슬라이스에서 제외하고 원문 유지. 0=비활성(기존 동작·pin 없음). 리딩 system
   *  메시지가 있어도 첫 user 메시지까지 자동 확장(computeAnchorCount 참조). */
  preserveFirst: number;
  microcompactAgeThreshold: number;
  toolOutputCharBudget: number;
  toolOutputTailLines: number;
  archiveEnabled: boolean;
  archiveDir?: string;
}

export const DEFAULT_COMPACT_POLICY: CompactPolicy = {
  preserveLastN: 6,
  preserveFirst: 0,
  microcompactAgeThreshold: 5,
  toolOutputCharBudget: 50_000,
  toolOutputTailLines: 30,
  archiveEnabled: true,
  archiveDir: undefined,
};

/** What the pipeline returns — old messages (untouched), new
 *  messages (post-compact), and per-layer diagnostics so callers can
 *  surface "before/after" deltas without re-counting tokens. */
export interface CompactPipelineResult {
  /** Replacement message array — pass straight to next LLM call. */
  messages: LLMMessage[];
  /** Per-layer diagnostics. Each layer increments `chars`/`bytes` it
   *  cleared so the slash response can show e.g. "Layer 1 saved 12K
   *  chars · Layer 2 saved 4 tool results". */
  diagnostics: {
    layer1ToolOutputBudgetSavedChars: number;
    layer1ResponsesTrimmed: number;
    layer2MicrocompactCleared: number;
    layer2MicrocompactSavedChars: number;
    /** Wave 4 — LLM summary fired? (boolean kept as 0/1 for
     *  forensic-grep friendliness.) */
    layer3SummaryApplied: 0 | 1;
    /** Wave 4 — model actually used for summarization (catalog hint
     *  resolution); empty when Layer 3 didn't run. */
    layer3SummaryModel: string;
    /** Wave 4 — chars in the produced summary (replaces the entire
     *  pre-summary slice). */
    layer3SummaryChars: number;
    /** Wave 5 — verify probe verdict ('skipped' | 'ok' | 'rejected'). */
    layer4VerifyVerdict: 'skipped' | 'ok' | 'rejected';
    /** Wave 5 — fallback truncate fired? (1 when summarize returned
     *  null / verify rejected → pipeline applied truncateProportional
     *  to the largest tool_result). */
    layer5FallbackTruncated: 0 | 1;
    /** Wave 5 — circuit breaker state at the time of run. */
    breakerTripped: 0 | 1;
    archived: number;
    /** Wave 7 (2026-05-04) — user-message replay applied? Fires when
     *  Layer 3 summarize runs AND the post-compact tail contains no
     *  user role (assistant-only chain), in which case the last user
     *  message from the summarized slice is re-emitted (text-only,
     *  media stripped) right after the summary so the model retains a
     *  clear task-intent anchor. ref/opencode `compaction.process`
     *  (session/compaction.ts:155-175, 283-338) pattern. */
    userReplayApplied: 0 | 1;
  };
}

/** Single archive record — one line of the JSONL when persistence is
 *  on. Replaying lets `/compact --replay` (future) or post-mortem
 *  debugging recover the original content. */
export interface CompactArchiveEntry {
  ts: number;
  layer: 'tool-output-budget' | 'microcompact' | 'truncate-proportional';
  /** Logical session id — caller-provided so multiple sessions don't
   *  trample each other's archives. Use 'default' when unset. */
  sessionId: string;
  /** Where the cleared chunk came from. Tool results carry the
   *  tool_use id; truncate-proportional carries the message index. */
  origin: {
    kind: 'tool_result' | 'truncated_tail';
    tool_use_id?: string;
    messageIndex?: number;
  };
  /** Original content that got removed/trimmed. */
  content: string;
  /** Pointer phrase that replaced the content in-place ("Full output
   *  saved to: <path>" or "[Old tool result content cleared]"). */
  replacement: string;
}
