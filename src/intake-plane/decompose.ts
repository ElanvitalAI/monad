/**
 * `intake.decompose_memo` — Phase 1 / I1 / RESEARCH §4.2 + §6.1.
 *
 * Turn a raw memo dump (multi-paragraph free-form text) into a
 * structured `MemoDecomposition`:
 *   - 1..M proposed missions (cohesive intent groups)
 *   - each mission carries 1..N proposed tasks (atomic intents)
 *
 * The actual LLM call is injected via `DecomposeMemoCallable` — same
 * DI shape as `task-orchestrator/generator.ts`. Tests pass a stub
 * callable; production wires the same `streamLLM*` path the rest of
 * monad uses. This module does **not** mutate TOX; I8 register_all is
 * the only place that creates Mission / Task rows from a decomposition.
 *
 * Output format: JSON (vs. RESEARCH §6.1's YAML sketch). The prompt
 * locks the model to a single fenced JSON block — easier to parse and
 * keeps fence tolerance identical to the existing decompose pipeline.
 *
 * Skeleton fallback (D4 enabled · single-mission with the raw text as
 * one task) keeps downstream phases working even when the LLM goes off
 * the rails — the user sees the proposal in I7 preview and can edit.
 */

import { buildResponseFormatHeader } from './prompt-format.js';
import {
  isConcreteIntakeTaskDecisionSignal,
  isConcreteIntakeTaskInvariant,
  type IntakeTaskDecisionSignal,
  type IntakeTaskGates,
  type IntakeTaskInvariant,
} from './types.js';

// ──────────────────── Public shapes ────────────────────────────────────

export type ProposedConfidence = 'high' | 'medium' | 'low';

export interface ProposedMemoTask extends IntakeTaskGates {
  /** Stable id within a single decomposition (`t-<n>`). */
  id: string;
  title: string;
  /** What the user really wants — a one-line restatement above the verb. */
  intent: string;
  urls?: string[];
  keywords?: string[];
  /** Code refs · file paths · `package@version` · GitHub repo slugs. */
  refs: string[];
  confidence: ProposedConfidence;
}

export interface ProposedMission {
  /** Stable id within a single decomposition (`m-<n>`). */
  id: string;
  title: string;
  intent?: string;
  tasks: ProposedMemoTask[];
}

export interface DecomposeMemoUsage {
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  modelId?: string;
}

export interface MemoDecomposition {
  missions: ProposedMission[];
  rationale: string;
  /** Whether the result is the skeleton fallback (D4) — caller can
   *  surface a "LLM 분해 실패 — 사용자 수정 필요" hint. */
  fallback: boolean;
  usage?: DecomposeMemoUsage;
}

export interface DecomposeMemoInput {
  rawText: string;
  /** Optional intake session id — propagated to the output so I8 can
   *  bind the resulting Mission rows back to their origin. */
  intakeId?: string;
  /** Soft cap on missions returned. Default 8. */
  maxMissions?: number;
  /** Soft cap on tasks-per-mission. Default 8. */
  maxTasksPerMission?: number;
  /** FU-I7e (2026-05-12) — natural-language nudge from the user after
   *  reviewing a prior decomposition. e.g. "missions 더 작게" or
   *  "t-9, t-10, t-11 을 하나로 합쳐". When set, the prompt frames the
   *  task as a refinement on top of `priorDecomposition` instead of
   *  a fresh decompose. Empty string is treated as no hint. */
  refinementHint?: string;
  /** FU-I7e — the LLM's previous output that the user is asking to
   *  refine. Only the `missions` shape is read by the prompt builder
   *  (rationale + fallback are ignored — the refinement spawns its
   *  own rationale). */
  priorDecomposition?: {
    missions: Array<{
      id: string;
      title: string;
      intent?: string;
      tasks: Array<Pick<ProposedMemoTask, 'id' | 'title' | 'intent' | 'confidence'>>;
    }>;
  };
}

export interface DecomposeMemoCallable {
  (args: {
    prompt: string;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    modelId?: string;
  }>;
}

export class DecomposeMemoError extends Error {
  constructor(
    public readonly code:
      | 'EMPTY_MEMO'
      | 'LLM_CALL_FAILED'
      | 'PARSE_FAILED'
      | 'VALIDATION_FAILED',
    message: string,
    public readonly rawText?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'DecomposeMemoError';
  }
}

// ──────────────────── Prompt builder ───────────────────────────────────

const DEFAULT_MAX_MISSIONS = 8;
const DEFAULT_MAX_TASKS_PER_MISSION = 8;

export function buildDecomposeMemoPrompt(input: DecomposeMemoInput): string {
  const maxMissions = input.maxMissions ?? DEFAULT_MAX_MISSIONS;
  const maxTasks = input.maxTasksPerMission ?? DEFAULT_MAX_TASKS_PER_MISSION;
  const refinement = refinementContext(input);
  const jsonShape = [
    '{',
    '  "rationale": "<2-4 문장 요약: 어떻게 분해했고 왜>",',
    '  "missions": [',
    '    {',
    '      "id": "m-1",',
    '      "title": "<인간 친화 그룹 title>",',
    '      "intent": "<선택: 미션의 한 줄 의도>",',
    '      "tasks": [',
    '        {',
    '          "id": "t-1",',
    '          "title": "<action 동사 포함 task title>",',
    '          "intent": "<사용자가 진짜 원하는 것 1줄>",',
    '          "urls": ["..."],',
    '          "keywords": ["..."],',
    '          "refs": ["..."],',
    '          "confidence": "high",',
    '          "invariants": [{"condition": "<what must remain true>", "verification": "<specific test or command>", "expected": "<observable result>"}],',
    '          "decisionSignals": [{"condition": "<decision condition>", "observation": "<measured observation>", "expected": "<expected result>"}]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ].join('\n');
  return [
    'SYSTEM:',
    refinement
      ? '당신은 monad intake refiner 입니다. 사용자가 이전 분해 결과에 대해 수정 요청을 합니다 — 원본 memo 는 유지하면서 hint 를 반영하여 새 분해를 제시하세요.'
      : '당신은 monad intake decomposer 입니다. 사용자의 raw memo dump 를 mission/task 단위로 분해하세요.',
    '',
    '규칙:',
    '- 구분자 detect: ===, ---, 빈 줄, indent, bullet point',
    '- 의미 단위 추출: 1 task = 1 의도 (boundary 명확). 너무 잘게 쪼개지 마세요.',
    '- hierarchy: mission > task (큰 카테고리가 명확하면 묶고, 아니면 1 mission + N task)',
    '- metadata: URL · 키워드 · 코드 ref · 기술명 추출',
    '- intent 필드: 사용자가 "진짜 원하는 것" 1줄 (verb 시작 권장)',
    '- 모호하면 confidence=low 로 표기',
    '- every task must include at least one concrete invariant and decision signal; name an executable verification and observable expected result, never TBD/placeholders',
    `- 출력 총 mission ≤ ${maxMissions} · 각 mission tasks ≤ ${maxTasks}`,
    ...(refinement
      ? [
          '- 사용자 hint 를 우선 반영하되, 원본 memo 의 정보 손실 없도록 보존.',
          '- mission/task id 는 새로 부여 (m-1 부터 다시 시작) — 이전 id 와 충돌 무관.',
          '- rationale 에는 어떤 hint 를 어떻게 적용했는지 1-2 문장 명시.',
        ]
      : []),
    '',
    ...buildResponseFormatHeader(jsonShape),
    '',
    // FU8 PR #7 (FU-I7a.2 · 2026-05-12) — one worked example to nudge
    // the LLM toward the right granularity (1 task = 1 intent · group
    // by mission · extract URL + keywords + refs). Example is short
    // enough to keep prompt-token cost low; deliberately omits the
    // refinement path (the same shape applies, just with mission/task
    // ids re-issued from m-1 / t-1). Phase-specific examples for
    // categorize + goal-align are deferred per FU-I7a.2 sub-spec
    // (waiting on dogfood signal `fallbackRate.{categorize,align}`).
    'WORKED EXAMPLE (참고용 · 출력 schema 와 동일한 모양):',
    'memo: "- mermaid live render 가능한지 확인\\n- youtube 동영상 transcript 흡수 (https://youtu.be/dQw4w9WgXcQ)\\n\\n=== 이번 주말 ===\\n공원 가서 자전거 타기"',
    '응답:',
    '```json',
    '{',
    '  "rationale": "memo 가 \\"기술 학습 (구분자 빈 줄)\\" + \\"=== 이번 주말 === 개인 일정\\" 2 mission 으로 자연 분기. 첫 mission 은 2 task, 둘째는 1 task.",',
    '  "missions": [',
    '    {',
    '      "id": "m-1",',
    '      "title": "기술 학습 — diagram + video",',
    '      "intent": "Mermaid 렌더링 + YouTube transcript 흡수 능력 확인",',
    '      "tasks": [',
    '        {',
    '          "id": "t-1",',
    '          "title": "Mermaid live render 가능 여부 조사",',
    '          "intent": "Mermaid 코드를 inline preview 로 렌더하는 방법 확인",',
    '          "urls": [],',
    '          "keywords": ["mermaid", "live-render"],',
    '          "refs": [],',
    '          "confidence": "high",',
    '          "invariants": [{"condition": "기존 chat markdown 출력이 유지된다", "verification": "현재 renderer 회귀 테스트를 실행한다", "expected": "기존 markdown assertion이 모두 통과한다"}],',
    '          "decisionSignals": [{"condition": "Mermaid preview 방법이 확인된다", "observation": "조사 결과에 renderer 진입점과 재현 절차가 기록된다", "expected": "진입점과 재현 절차가 각각 하나 이상 있다"}]',
    '        },',
    '        {',
    '          "id": "t-2",',
    '          "title": "YouTube transcript 흡수 pipeline 검토",',
    '          "intent": "특정 영상의 자막을 추출해 노트화하는 흐름 설계",',
    '          "urls": ["https://youtu.be/dQw4w9WgXcQ"],',
    '          "keywords": ["youtube", "transcript"],',
    '          "refs": ["https://youtu.be/dQw4w9WgXcQ"],',
    '          "confidence": "high",',
    '          "invariants": [{"condition": "원본 영상 URL이 보존된다", "verification": "산출물의 source URL을 입력 URL과 비교한다", "expected": "두 URL이 같다"}],',
    '          "decisionSignals": [{"condition": "transcript 흡수 방법이 확인된다", "observation": "조사 결과의 추출 단계 목록", "expected": "자막 획득부터 노트 저장까지 단계가 기록된다"}]',
    '        }',
    '      ]',
    '    },',
    '    {',
    '      "id": "m-2",',
    '      "title": "이번 주말 개인 일정",',
    '      "intent": "주말 활동 정리",',
    '      "tasks": [',
    '        {',
    '          "id": "t-3",',
    '          "title": "공원 자전거 라이드",',
    '          "intent": "주말 운동 — 공원에서 자전거 타기",',
    '          "urls": [],',
    '          "keywords": ["cycling", "park"],',
    '          "refs": [],',
    '          "confidence": "high",',
    '          "invariants": [{"condition": "주말 자전거 활동 의도가 유지된다", "verification": "정리된 일정의 활동명을 원문과 비교한다", "expected": "자전거 활동이 남아 있다"}],',
    '          "decisionSignals": [{"condition": "일정이 실행 가능하게 정리된다", "observation": "일정에 기록된 장소와 시간", "expected": "장소와 시간이 모두 정해져 있다"}]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    ...(refinement
      ? [
          'PRIOR DECOMPOSITION (refine 대상):',
          refinement.priorJson,
          '',
          'USER REFINEMENT HINT:',
          refinement.hint,
          '',
        ]
      : []),
    'USER MEMO (원본):',
    input.rawText,
  ].join('\n');
}

/** FU-I7e — derive the refinement block for the prompt builder. Returns
 *  null when no hint is supplied or when the hint is whitespace-only.
 *  Exported for unit testing the conditional. */
export function refinementContext(
  input: DecomposeMemoInput,
): { hint: string; priorJson: string } | null {
  const hint = input.refinementHint?.trim();
  if (!hint) return null;
  // Compact prior — strip rationale + fallback flag from the JSON so
  // the prompt stays focused on the structural shape the user is
  // asking to revise.
  const priorMissions = input.priorDecomposition?.missions ?? [];
  const priorJson = JSON.stringify({ missions: priorMissions }, null, 2);
  return { hint, priorJson };
}

// ──────────────────── Parser ───────────────────────────────────────────

/** Strip fences and locate a balanced JSON object. */
export function extractJsonBlock(text: string): unknown | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\n([\s\S]*?)```/);
  const candidate = fence ? fence[1]! : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const open = candidate.indexOf('{');
    const close = candidate.lastIndexOf('}');
    if (open >= 0 && close > open) {
      try {
        return JSON.parse(candidate.slice(open, close + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

function asConfidence(v: unknown): ProposedConfidence {
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'medium';
}

function asInvariants(value: unknown): IntakeTaskInvariant[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) return null;
  const invariants = value.filter(isConcreteIntakeTaskInvariant).map((item) => ({
    condition: item.condition.trim(),
    verification: item.verification.trim(),
    expected: item.expected.trim(),
  }));
  return invariants.length === value.length ? invariants : null;
}

function asDecisionSignals(value: unknown): IntakeTaskDecisionSignal[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) return null;
  const signals = value.filter(isConcreteIntakeTaskDecisionSignal).map((item) => ({
    condition: item.condition.trim(),
    observation: item.observation.trim(),
    expected: item.expected.trim(),
  }));
  return signals.length === value.length ? signals : null;
}

/**
 * Validate + coerce a raw parsed decomposition. Returns `null` when the
 * shape is unrecoverable. Soft-tolerant: drops malformed tasks rather
 * than rejecting the whole proposal so the user still sees a useful
 * preview.
 */
export function coerceDecomposition(raw: unknown): MemoDecomposition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const missionsRaw = r.missions;
  if (!Array.isArray(missionsRaw) || missionsRaw.length === 0) return null;

  const missions: ProposedMission[] = [];
  for (let i = 0; i < missionsRaw.length; i += 1) {
    const m = missionsRaw[i] as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') continue;
    const title = asString(m.title);
    if (!title || title.length === 0) continue;
    const tasksRaw = m.tasks;
    if (!Array.isArray(tasksRaw)) continue;
    const tasks: ProposedMemoTask[] = [];
    for (let j = 0; j < tasksRaw.length; j += 1) {
      const t = tasksRaw[j] as Record<string, unknown> | undefined;
      if (!t || typeof t !== 'object') continue;
      const tTitle = asString(t.title);
      const refs = asStringArray(t.refs) ?? [];
      const authoredInvariants = asInvariants(t.invariants);
      const authoredDecisionSignals = asDecisionSignals(t.decisionSignals);
      if (!tTitle || tTitle.length === 0 || !authoredInvariants || !authoredDecisionSignals) continue;
      tasks.push({
        id: asString(t.id) ?? `t-${j + 1}`,
        title: tTitle,
        intent: asString(t.intent) ?? tTitle,
        urls: asStringArray(t.urls),
        keywords: asStringArray(t.keywords),
        refs,
        confidence: asConfidence(t.confidence),
        invariants: authoredInvariants,
        decisionSignals: authoredDecisionSignals,
      });
    }
    if (tasks.length === 0) continue;
    missions.push({
      id: asString(m.id) ?? `m-${i + 1}`,
      title,
      intent: asString(m.intent),
      tasks,
    });
  }

  if (missions.length === 0) return null;
  return {
    missions,
    rationale: asString(r.rationale) ?? 'no rationale provided',
    fallback: false,
  };
}

// ──────────────────── Skeleton fallback (D4) ───────────────────────────

/**
 * When the LLM call or parse fails, preserve the raw memo as a reviewable
 * draft task. Empty refs and gates deliberately make it non-launchable at
 * the harness translation boundary without blocking downstream preview.
 */
export function skeletonFallback(input: DecomposeMemoInput): MemoDecomposition {
  const trimmed = input.rawText.trim();
  const firstLine = trimmed.split('\n')[0]?.trim() ?? 'Memo intake';
  const title = firstLine.slice(0, 80) || 'Memo intake';
  return {
    rationale: `LLM decompose unavailable — '${title}' is preserved as a draft and requires researched refs and gates before launch.`,
    fallback: true,
    missions: [{
      id: 'm-1',
      title,
      intent: trimmed,
      tasks: [{
        id: 't-1',
        title,
        intent: trimmed,
        refs: [],
        confidence: 'low',
        invariants: [],
        decisionSignals: [],
      }],
    }],
  };
}

// ──────────────────── Public entry point ───────────────────────────────

export interface DecomposeMemoOptions {
  callable: DecomposeMemoCallable;
  signal?: AbortSignal;
  /** When `true`, throw on parse failure instead of returning the
   *  skeleton fallback. Default `false` (D4 enabled). */
  strict?: boolean;
}

/**
 * Run the I1 decompose phase. Always returns a `MemoDecomposition` —
 * even when the LLM mangles the response, the skeleton fallback keeps
 * downstream phases unblocked. Set `strict: true` to opt out.
 */
export async function decomposeMemo(
  input: DecomposeMemoInput,
  opts: DecomposeMemoOptions,
): Promise<MemoDecomposition> {
  if (!input.rawText || input.rawText.trim().length === 0) {
    throw new DecomposeMemoError('EMPTY_MEMO', 'rawText is required');
  }

  const prompt = buildDecomposeMemoPrompt(input);
  let raw;
  try {
    raw = await opts.callable({ prompt, signal: opts.signal });
  } catch (err) {
    if (opts.strict) {
      throw new DecomposeMemoError(
        'LLM_CALL_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
    return skeletonFallback(input);
  }

  const parsed = extractJsonBlock(raw.text);
  if (parsed === null) {
    if (opts.strict) {
      throw new DecomposeMemoError('PARSE_FAILED', 'no JSON block found', raw.text);
    }
    return skeletonFallback(input);
  }
  const coerced = coerceDecomposition(parsed);
  if (coerced === null) {
    if (opts.strict) {
      throw new DecomposeMemoError(
        'VALIDATION_FAILED',
        'decomposition shape unrecoverable',
        raw.text,
      );
    }
    return skeletonFallback(input);
  }

  return {
    ...coerced,
    usage: {
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
      costUsd: raw.costUsd,
      modelId: raw.modelId,
    },
  };
}
