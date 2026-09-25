// W9b Z10 · Next-Scenario Fluent Showroom — task done lifecycle hook.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §4 Z10.
//
// When a task / workflow run reaches a terminal state, an opt-in cascade
// can fire that asks "what's the obvious next step?" and surfaces 1-5
// one-click candidates so the user stays in flow. The cascade is:
//   1. `NextActionSource.top(...)` produces deterministic candidates
//      (stub: rule-based; future: KGS- + LLM-judged).
//   2. Three personas — `continuator` (carry the work forward),
//      `opportunist` (lateral leverage), `closer` (wrap up cleanly) —
//      each get a turn at the same showroom lane callable.
//   3. `reduceFluentSuggestions` merges the persona texts against the
//      source candidates and emits a stable `NextFluentCard`.
//
// Like Z5 (`post-run-showroom.ts`), this module owns *no* lifecycle
// dispatch. The caller (daemon · TOX board · CLI) constructs a
// `TaskDoneRecord`, runs the hook, and forwards the resulting card to
// whichever surface wants to render it. `executor.ts` / `mission.ts`
// stay untouched — `feedback_presentation_no_content_mutation`.

import type {
  NextActionCandidate,
  NextActionContext,
  NextActionSource,
} from '../intent-prediction/next-action-source.js';
import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from './surfaces/showroom-surface.js';
import type { TaskSurfaceKind } from './types.js';

/** Persona id triple used by the Z10 cascade. The order doubles as the
 *  lane execution order — `continuator` produces forward-motion text
 *  first, then `opportunist` responds with lateral picks, then `closer`
 *  offers wrap-up paths. */
export const NEXT_FLUENT_PERSONAS = ['continuator', 'opportunist', 'closer'] as const;
export type NextFluentPersona = (typeof NEXT_FLUENT_PERSONAS)[number];

export interface TaskDoneRecord {
  /** Stable id of the finished task / run — used as `NextFluentCard.refId`. */
  refId: string;
  /** Free-form kind tag (`'task'`, `'workflow-run'`, `'mission-arc'`, ...). */
  refKind: string;
  /** Surface kind the finished task ran on. `null` when unknown. */
  finishedSurface: TaskSurfaceKind | null;
  outcome: 'ok' | 'failed';
  completedAt: number;
  /** Optional Z5 retro summary so the personas can reference it. */
  retroSummary?: string;
  /** Loose labels (skill name · workflow node · mission tag) that the
   *  source uses to score candidates. */
  tags?: string[];
}

export interface NextFluentSuggestion {
  /** Canonical action label produced by the source. */
  kind: string;
  /** `0..1` — rank score. The hook reuses the source's score so the
   *  ordering stays stable across re-renders. */
  score: number;
  /** Which persona endorsed this candidate, or `'none'` when only the
   *  source produced it (no persona line matched the kind). */
  endorsedBy: NextFluentPersona | 'none';
  /** Persona one-liner — empty when no persona endorsed. */
  reason: string;
  surfaceHint: TaskSurfaceKind | null;
}

export interface NextFluentCard {
  kind: 'next-fluent';
  refId: string;
  refKind: string;
  /** 1-5 ranked suggestions. Empty when the source returned nothing —
   *  the caller treats that as "no fluent chip to show". */
  suggestions: NextFluentSuggestion[];
  /** Persona transcript joined by `\n\n## <persona>...` headers so a
   *  patcher can later distil deeper claims. */
  transcript: string;
  createdAt: number;
}

export interface NextFluentHookDeps {
  /** 페르소나 LLM lane. **옵션(2026-07-15)** — 없으면 결정론 후보 직접 반환(페르소나 스킵·무비용).
   *  mission-fabric 액션 후보는 그 자체가 액션이라 LLM endorsement 없이도 유효. 켜면 로컬 이유 부여. */
  laneCallable?: ShowroomLaneCallable;
  source: NextActionSource;
  /** Opt-in toggle. Default OFF — daemon flips it via user-config when
   *  the user enables the fluent showroom. */
  enabled: () => boolean;
  /** Persona → model pin. Defaults are conservative locals so the hook
   *  does not silently spend cloud budget. */
  models?: Partial<Record<NextFluentPersona, string>>;
  /** Hard cap on suggestions surfaced. Defaults to 5 (Loop 8 spec). */
  maxSuggestions?: number;
  /** Test seam. */
  now?: () => number;
}

const DEFAULT_MODELS: Record<NextFluentPersona, string> = {
  continuator: 'qwen-7b',
  opportunist: 'qwen-7b',
  closer: 'qwen-7b',
};

export async function runNextFluentShowroom(
  record: TaskDoneRecord,
  deps: NextFluentHookDeps,
): Promise<NextFluentCard | null> {
  if (!deps.enabled()) return null;

  const limit = clampPositive(deps.maxSuggestions ?? 5, 5);
  const ctx = toSourceContext(record);
  const candidates = await safeTop(deps.source, ctx, limit);
  if (candidates.length === 0) {
    // Source declined — fluent chip would be empty. Returning `null`
    // lets the caller distinguish "OFF" vs "no candidates" if it cares,
    // but the common path is to treat both as "nothing to render".
    return null;
  }

  const now0 = (deps.now ?? Date.now)();
  // ★ 결정론 경로(2026-07-15) — laneCallable 미주입이면 페르소나 LLM 스킵. 후보(=실제 액션)를 그대로
  //   제안으로(endorsedBy:none·reason=rationale). 무비용·즉시. mission-fabric 액션에 기본.
  if (!deps.laneCallable) {
    return {
      kind: 'next-fluent',
      refId: record.refId,
      refKind: record.refKind,
      suggestions: candidates.map((c) => ({
        kind: c.kind, score: c.score, endorsedBy: 'none' as const,
        reason: c.rationale ?? '', surfaceHint: c.surfaceHint ?? null,
      })),
      transcript: '',
      createdAt: now0,
    };
  }

  const laneCallable = deps.laneCallable; // 위 가드로 defined 확정(TS 내로잉 캡처).
  const models = { ...DEFAULT_MODELS, ...(deps.models ?? {}) };
  const personaRuns: Array<{ persona: NextFluentPersona; out: ShowroomLaneOutput }> = [];

  // Each persona sees the same candidate list — the prior persona's
  // output is *not* threaded into the next prompt. Personas are siblings
  // (parallel by spec), but we await serially so the lane callable can
  // be a single-flight in-process implementation.
  for (const persona of NEXT_FLUENT_PERSONAS) {
    const out = await laneCallable({
      role: laneRoleForPersona(persona),
      model: models[persona],
      prompt: buildPersonaPrompt(persona, record, candidates),
    });
    personaRuns.push({ persona, out });
  }

  const now = now0;
  const suggestions = reduceFluentSuggestions(candidates, personaRuns);
  const transcript = joinTranscript(personaRuns);

  return {
    kind: 'next-fluent',
    refId: record.refId,
    refKind: record.refKind,
    suggestions,
    transcript: transcript.slice(0, 16384),
    createdAt: now,
  };
}

/** Pure reducer — exported so a follow-up KGS writer can replay
 *  persona transcripts against an updated candidate list without
 *  re-firing the lanes. */
export function reduceFluentSuggestions(
  candidates: NextActionCandidate[],
  personaRuns: ReadonlyArray<{ persona: NextFluentPersona; out: ShowroomLaneOutput }>,
): NextFluentSuggestion[] {
  const byKind = new Map<string, { persona: NextFluentPersona; reason: string }>();
  for (const run of personaRuns) {
    for (const match of extractEndorsements(run.out.text, candidates)) {
      if (!byKind.has(match.kind)) {
        byKind.set(match.kind, { persona: run.persona, reason: match.reason });
      }
    }
  }
  return candidates.map((c) => {
    const endorsement = byKind.get(c.kind);
    return {
      kind: c.kind,
      score: c.score,
      endorsedBy: endorsement?.persona ?? 'none',
      reason: endorsement?.reason ?? c.rationale ?? '',
      surfaceHint: c.surfaceHint ?? null,
    };
  });
}

function extractEndorsements(
  text: string,
  candidates: NextActionCandidate[],
): Array<{ kind: string; reason: string }> {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hits: Array<{ kind: string; reason: string }> = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-•*\d.)\s]+/, '').trim();
    if (!cleaned) continue;
    for (const c of candidates) {
      if (cleaned.toLowerCase().includes(c.kind.toLowerCase())) {
        // Strip the matched kind out of the reason so the chip
        // tooltip is the persona's *commentary*, not an echo. Use
        // word boundaries so short kind names ("a") don't eat
        // letters inside surrounding words.
        const escaped = c.kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reason = cleaned
          .replace(new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'ig'), '$1$2')
          .replace(/^[\s:—–-]+/, '')
          .trim()
          || cleaned;
        hits.push({ kind: c.kind, reason });
        break;
      }
    }
  }
  return hits;
}

function toSourceContext(record: TaskDoneRecord): NextActionContext {
  return {
    refId: record.refId,
    refKind: record.refKind,
    finishedSurface: record.finishedSurface,
    outcome: record.outcome,
    retroSummary: record.retroSummary ?? '',
    tags: record.tags ?? [],
  };
}

async function safeTop(
  source: NextActionSource,
  ctx: NextActionContext,
  limit: number,
): Promise<NextActionCandidate[]> {
  try {
    const list = await source.top(ctx, limit);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function buildPersonaPrompt(
  persona: NextFluentPersona,
  record: TaskDoneRecord,
  candidates: NextActionCandidate[],
): string {
  const stance = personaStance(persona);
  const candidateLines = candidates
    .map((c) => `- ${c.kind} (score=${c.score.toFixed(2)})${c.rationale ? ` — ${c.rationale}` : ''}`)
    .join('\n');
  return [
    `You are the "${persona}" lane in a 1-click fluent-chain showroom.`,
    stance,
    '',
    `Finished ref: ${record.refKind}/${record.refId}`,
    `Outcome    : ${record.outcome}`,
    record.retroSummary ? `Retro summary: ${record.retroSummary}` : '',
    '',
    'Candidates the predictor surfaced:',
    candidateLines,
    '',
    'Pick at most 3 candidates you endorse. One per line, each line:',
    '  <candidate-kind> — <one-sentence reason>',
    'Do not invent new candidate kinds. No preamble.',
  ].filter((l) => l !== '').join('\n');
}

function personaStance(persona: NextFluentPersona): string {
  switch (persona) {
    case 'continuator':
      return 'Push the current thread forward — pick candidates that keep momentum on the same goal.';
    case 'opportunist':
      return 'Look sideways — pick candidates that unlock parallel value the user might otherwise miss.';
    case 'closer':
      return 'Wrap up cleanly — pick candidates that lower outstanding state (archive, retro, follow-up file).';
  }
}

function laneRoleForPersona(persona: NextFluentPersona): 'plan' | 'build' | 'review' | 'reflect' {
  // Showroom lane roles map onto personas one-for-one; the role is
  // surfaced in the transcript header so a patcher can see which lane
  // produced which lines without parsing the persona name back out.
  switch (persona) {
    case 'continuator': return 'plan';
    case 'opportunist': return 'build';
    case 'closer':      return 'reflect';
  }
}

function joinTranscript(
  runs: ReadonlyArray<{ persona: NextFluentPersona; out: ShowroomLaneOutput }>,
): string {
  return runs
    .map((r) => `## ${r.persona} · ${r.out.modelId ?? 'n/a'}\n${r.out.text}`)
    .join('\n\n');
}

function clampPositive(n: number, cap: number): number {
  if (!Number.isFinite(n) || n <= 0) return cap;
  return Math.min(Math.floor(n), cap);
}
