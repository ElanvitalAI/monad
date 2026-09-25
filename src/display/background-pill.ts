// Wave P2 (presentation) · A3-1 — typed background pill.
//
// Renders a single-line summary of "what's running in the background"
// across three source types: shell commands, sub-agents, and plugin
// workflows. (⛔ 종전 이 줄은 "four … and scheduled jobs" 였다 — 아래 V2.2-5 가
//  `scheduler` 를 은퇴시킨 뒤에도 «머리말만» 안 따라갔고, 그래서 시험이 3.5개월 동안
//  「scheduled job」을 물다 빨갰다. 은퇴는 «세 자리»를 고쳐야 한다 — 타입 · 머리말 · 시험.)
// The chat-surface pill lets the
// operator see active work without opening the roster widget or
// `/ps` slash. Mirrors claude-code-fork's `getPillLabel`
// (`tasks/pillLabel.ts:10-82`) typed-summary pattern, adapted to
// monad's chatLines string surface.
//
// Pure function — no side effects. Returns null when nothing is
// running so the caller skips the chat block entirely.

// Surface-unification v2.2 V2.2-5 (2026-05-11) — `scheduler` counter
// retired. Scheduled work now surfaces as workflow runs, so the
// `workflow` field already covers what was a duplicate signal.
export interface BackgroundPillCounts {
  shell: number;
  agent: number;
  workflow: number;
}

/** Wave P4c — attention CTA can now distinguish the trigger source.
 *  `true` keeps the legacy single-color behavior; an object lets the
 *  caller route different colors / hints per trigger.
 *   - needsInput: cyan accent — "answer a question / approval"
 *   - planReady:  yellow accent — "ExitPlanMode decision waiting"
 *   - hasError:   red accent — "stalled / failed somewhere" */
export type BackgroundPillAttention =
  | boolean
  | {
      needsInput?: boolean;
      planReady?: boolean;
      hasError?: boolean;
    };

export interface BackgroundPillOptions {
  /** Show an attention CTA suffix. Boolean form keeps the legacy
   *  single-color path; object form drives per-trigger color routing. */
  attention?: BackgroundPillAttention;
  /** Theme color hooks. Identity functions are valid for tests. */
  colors?: {
    muted?: (s: string) => string;
    accent?: (s: string) => string;
    /** Wave P4c — additional slots for typed attention. Caller maps
     *  each trigger source to a theme function. Falls back to `accent`
     *  when not provided so existing callers don't need to update. */
    needsInput?: (s: string) => string;
    planReady?: (s: string) => string;
    hasError?: (s: string) => string;
  };
}

const ID = (s: string): string => s;

const LEAD_GLYPH = '◇';

// ⭐ 카운터와 라벨을 «한 표»로 묶는다 — `keyof BackgroundPillCounts` 제약이 있어
//   카운터가 늘거나 은퇴하면 ***이 표가 강제로 따라온다***(타입이 막는다).
//   📏 그것이 없어서 2026-05-11 의 `scheduler` 은퇴가 «타입만» 가고 머리말·시험이 3.5개월 남았다.
const PILL_SOURCES = [
  ['agent', 'agent'],
  ['shell', 'shell'],
  ['workflow', 'workflow'],
] as const satisfies readonly (readonly [keyof BackgroundPillCounts, string])[];

function pluralize(n: number, singular: string, plural?: string): string {
  if (n === 1) return `${n} ${singular}`;
  return `${n} ${plural ?? `${singular}s`}`;
}

export function totalRunning(counts: BackgroundPillCounts): number {
  return counts.shell + counts.agent + counts.workflow;
}

/** Wave P4c — pick the dominant attention color + hint based on
 *  trigger priority (error > needs-input > plan-ready). Returns
 *  null when no attention triggers are active. */
function resolveAttentionStyle(
  attention: BackgroundPillAttention | undefined,
  colors: BackgroundPillOptions['colors'],
): { color: (s: string) => string; hint: string } | null {
  if (!attention) return null;
  const accent = colors?.accent ?? ID;
  if (attention === true) {
    return { color: accent, hint: '↓ to view' };
  }
  // Priority: error > needsInput > planReady. The lead glyph + hint
  // pick the highest-priority active trigger so the operator sees
  // the most actionable signal first.
  if (attention.hasError) {
    return { color: colors?.hasError ?? accent, hint: '↓ errors' };
  }
  if (attention.needsInput) {
    return { color: colors?.needsInput ?? accent, hint: '↓ needs input' };
  }
  if (attention.planReady) {
    return { color: colors?.planReady ?? accent, hint: '↓ plan ready' };
  }
  return null;
}

/** Render the typed pill. Returns null when the total is 0 — the
 *  caller skips the block entirely so an idle session shows no clutter. */
export function renderBackgroundPill(
  counts: BackgroundPillCounts,
  opts: BackgroundPillOptions = {},
): string | null {
  const total = totalRunning(counts);
  if (total === 0) return null;

  const muted = opts.colors?.muted ?? ID;

  const segments = PILL_SOURCES
    .filter(([source]) => counts[source] > 0)
    .map(([source, label]) => pluralize(counts[source], label));

  const attentionStyle = resolveAttentionStyle(opts.attention, opts.colors);
  const lead = attentionStyle ? attentionStyle.color(LEAD_GLYPH) : muted(LEAD_GLYPH);
  const body = muted(segments.join(' · '));
  const suffix = attentionStyle ? ` · ${attentionStyle.color(attentionStyle.hint)}` : '';

  return `${lead} ${body}${suffix}`;
}
