/**
 * `intake.goal_align` — Phase 1 / I4 / RESEARCH §4.5.
 *
 * Take an `EnrichedDecomposition` + `CategorizeResult` and produce a
 * priority assignment + (soft) dependency edges between tasks.
 *
 * Two paths converge here:
 *
 *   1. **Heuristic baseline** — deterministic priority derived from the
 *      task category (`workflowAlignmentByCategory`). Always runs, even
 *      when no LLM callable is supplied. The dogfood gate (90% auto
 *      decompose + register · 2분 안) only needs this layer to land.
 *
 *   2. **LLM refine** (optional) — when an `AlignCallable` is provided,
 *      a single medium prompt re-ranks priorities relative to an optional
 *      `goalContext` blurb (CLAUDE.md / STRATEGY excerpt) and proposes
 *      dependency edges. The output is treated as **soft** per D3: the
 *      user can reject individual edges in I7 preview, so we surface
 *      both the heuristic and the LLM view rather than throwing away
 *      the deterministic one.
 *
 * Output indexed by `taskKey` (same join key as I3). Like the other
 * phases, the actual mutation of TOX lives in I8 register_all.
 */
import type { EnrichedDecomposition, EnrichedTask } from './enrich.js';
import { summariseContext } from './enrich.js';
import type { CategorizeResult, TaskCategorization, TaskCategory } from './categorize.js';
import { isTaskCategory, taskKey } from './categorize.js';
import { buildResponseFormatHeader } from './prompt-format.js';

// ──────────────────── Public shapes ────────────────────────────────────

export type AlignPriority = 'high' | 'medium' | 'low';

export interface DependencyEdge {
  from: string;       // taskKey of the **prerequisite** (must finish first)
  to: string;         // taskKey of the dependent task
  /** When `true`, the user can drop the edge without consequence. D3 = soft. */
  soft: boolean;
  reason?: string;
}

export interface TaskAlignment {
  taskKey: string;
  priority: AlignPriority;
  /** Where the priority came from. `'heuristic'` = baseline only,
   *  `'llm'` = LLM refine overrode the heuristic, `'agreed'` = both
   *  paths matched. */
  source: 'heuristic' | 'llm' | 'agreed';
}

export interface GoalAlignResult {
  alignments: Record<string, TaskAlignment>;
  dependencies: DependencyEdge[];
  fallback: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    modelId?: string;
  };
}

export interface AlignCallable {
  (args: { prompt: string; signal?: AbortSignal }): Promise<{
    text: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
    modelId?: string;
  }>;
}

export class GoalAlignError extends Error {
  constructor(
    public readonly code: 'LLM_CALL_FAILED' | 'PARSE_FAILED',
    message: string,
    public readonly rawText?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'GoalAlignError';
  }
}

// ──────────────────── Heuristic priority by category ───────────────────

/**
 * Closed mapping from category → default priority. Lives next to the
 * RESEARCH §4.5 table so it's easy to read & adjust.
 *
 *   workflow-update → high  (work already in flight — finish it)
 *   dev-feature     → high  (user-visible capability)
 *   research-and-plan → medium
 *   research        → medium
 *   dev-spec        → medium
 *   cognitive       → low   (cannot automate; defer until user signals)
 *   debug           → low   (specific incident, low-cadence)
 */
const CATEGORY_PRIORITY: Record<TaskCategory, AlignPriority> = {
  'workflow-update': 'high',
  'dev-feature': 'high',
  'research-and-plan': 'medium',
  'research': 'medium',
  'dev-spec': 'medium',
  'cognitive': 'low',
  'debug': 'low',
};

export function priorityForCategory(category: TaskCategory): AlignPriority {
  return CATEGORY_PRIORITY[category];
}

// ──────────────────── Heuristic baseline ───────────────────────────────

function listTasks(
  decomposition: EnrichedDecomposition,
): Array<{ key: string; task: EnrichedTask; missionId: string; missionTitle: string }> {
  const out: Array<{
    key: string;
    task: EnrichedTask;
    missionId: string;
    missionTitle: string;
  }> = [];
  for (const m of decomposition.missions) {
    for (const t of m.tasks) {
      out.push({ key: taskKey(m.id, t.id), task: t, missionId: m.id, missionTitle: m.title });
    }
  }
  return out;
}

export function buildHeuristicAlignment(
  decomposition: EnrichedDecomposition,
  categorize: CategorizeResult,
): Record<string, TaskAlignment> {
  const out: Record<string, TaskAlignment> = {};
  for (const { key } of listTasks(decomposition)) {
    const cat = categorize.categorizations[key];
    const priority: AlignPriority = cat ? priorityForCategory(cat.category) : 'medium';
    out[key] = { taskKey: key, priority, source: 'heuristic' };
  }
  return out;
}

// ──────────────────── Prompt (LLM refine) ──────────────────────────────

export interface GoalAlignInput {
  decomposition: EnrichedDecomposition;
  categorize: CategorizeResult;
  /** Optional CLAUDE.md / STRATEGY excerpt to inform priority. */
  goalContext?: string;
}

export function buildGoalAlignPrompt(input: GoalAlignInput): string {
  const lines: string[] = [
    'SYSTEM:',
    '당신은 task 우선순위 + dependency 분석가 입니다.',
    '카테고리별 baseline priority 가 이미 제시되어 있습니다 — 사용자 goal context 에',
    '비추어 override 가 필요한 경우만 변경하세요. dependency 는 명백한 prerequisite',
    '관계 (B 가 A 의 산출물에 의존) 만 제안하고, 모호하면 비워 두세요.',
    '',
    'priority 종류: high | medium | low',
    '',
    ...buildResponseFormatHeader([
      '{',
      '  "alignments": [',
      '    { "key": "m-1/t-1", "priority": "high" }',
      '  ],',
      '  "dependencies": [',
      '    { "from": "m-1/t-1", "to": "m-1/t-2", "reason": "<짧은 근거>" }',
      '  ]',
      '}',
    ].join('\n')),
    '',
    // FU8 follow-up #2 (2026-05-12) — worked example covering the
    // 2 most-needed alignment cues:
    //   1. baseline priority OVERRIDE (e.g. user goal context calls
    //      out a research task as P0 so it bumps to high regardless
    //      of category default),
    //   2. dependency edge between two tasks in the same mission
    //      (research produces output that dev-feature consumes).
    // Tasks the LLM should LEAVE at baseline priority are
    // intentionally omitted from `alignments`; this nudges the
    // model toward minimal output (saves tokens · matches the
    // "override only when needed" rule above).
    'WORKED EXAMPLE (참고용):',
    'USER tasks:',
    '- key: m-1/t-1',
    '  mission: PR review fly-through',
    '  title: PR #2424 변경점 흡수',
    '  intent: 변경 영역 + 신규 API surface 정리',
    '  category: research',
    '  baselinePriority: medium',
    '- key: m-1/t-2',
    '  mission: PR review fly-through',
    '  title: 후속 PR 작성 (FU#1)',
    '  intent: 흡수 결과 기반 KGS Mission card 모듈 구현',
    '  category: dev-feature',
    '  baselinePriority: high',
    'USER goal context:',
    'PR review 가 오늘 stand-up 전에 끝나야 함. FU#1 은 review 가 끝나야 시작 가능.',
    '응답:',
    '```json',
    '{',
    '  "alignments": [',
    '    { "key": "m-1/t-1", "priority": "high" }',
    '  ],',
    '  "dependencies": [',
    '    { "from": "m-1/t-1", "to": "m-1/t-2", "reason": "후속 PR 은 흡수 결과를 입력으로 받음" }',
    '  ]',
    '}',
    '```',
    '',
    'USER tasks:',
  ];
  for (const { key, task, missionTitle } of listTasks(input.decomposition)) {
    const cat = input.categorize.categorizations[key];
    const baseline = cat ? priorityForCategory(cat.category) : 'medium';
    const ctx = summariseContext(task, 200);
    lines.push(`- key: ${key}`);
    lines.push(`  mission: ${missionTitle}`);
    lines.push(`  title: ${task.title}`);
    lines.push(`  intent: ${task.intent}`);
    lines.push(`  category: ${cat?.category ?? 'cognitive'}`);
    lines.push(`  baselinePriority: ${baseline}`);
    if (ctx) lines.push(`  context: ${ctx.replace(/\n/g, ' ')}`);
  }
  if (input.goalContext && input.goalContext.trim().length > 0) {
    lines.push('');
    lines.push('USER goal context:');
    lines.push(input.goalContext);
  }
  return lines.join('\n');
}

// ──────────────────── Parser ───────────────────────────────────────────

function extractJsonBlock(text: string): unknown | null {
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

function asPriority(v: unknown): AlignPriority | null {
  return v === 'high' || v === 'medium' || v === 'low' ? v : null;
}

export interface ParsedAlign {
  alignments: Array<{ key: string; priority: AlignPriority }>;
  dependencies: DependencyEdge[];
}

export function coerceLlmAlign(
  raw: unknown,
  validKeys: ReadonlySet<string>,
): ParsedAlign | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const alignmentsRaw = Array.isArray(r.alignments) ? r.alignments : [];
  const dependenciesRaw = Array.isArray(r.dependencies) ? r.dependencies : [];

  const alignments: Array<{ key: string; priority: AlignPriority }> = [];
  for (const a of alignmentsRaw) {
    if (!a || typeof a !== 'object') continue;
    const row = a as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key : null;
    const priority = asPriority(row.priority);
    if (!key || !priority) continue;
    if (!validKeys.has(key)) continue;
    alignments.push({ key, priority });
  }

  const dependencies: DependencyEdge[] = [];
  for (const d of dependenciesRaw) {
    if (!d || typeof d !== 'object') continue;
    const row = d as Record<string, unknown>;
    const from = typeof row.from === 'string' ? row.from : null;
    const to = typeof row.to === 'string' ? row.to : null;
    if (!from || !to) continue;
    if (from === to) continue;
    if (!validKeys.has(from) || !validKeys.has(to)) continue;
    dependencies.push({
      from,
      to,
      soft: true, // D3 — always soft
      reason: typeof row.reason === 'string' && row.reason.length > 0 ? row.reason : undefined,
    });
  }

  if (alignments.length === 0 && dependencies.length === 0) return null;
  return { alignments, dependencies };
}

// ──────────────────── Cycle break ──────────────────────────────────────

/**
 * Drop dependency edges that would close a cycle. Soft model — we want
 * to keep as many honest dependencies as possible without ever giving
 * I8 register_all a circular DAG. Strategy: walk edges in input order
 * and skip any edge whose addition would create a cycle reachable from
 * `to`.
 */
export function breakCycles(deps: ReadonlyArray<DependencyEdge>): DependencyEdge[] {
  const adj = new Map<string, Set<string>>();
  const accepted: DependencyEdge[] = [];
  for (const edge of deps) {
    if (wouldCreateCycle(adj, edge.from, edge.to)) continue;
    accepted.push(edge);
    let set = adj.get(edge.from);
    if (!set) {
      set = new Set();
      adj.set(edge.from, set);
    }
    set.add(edge.to);
  }
  return accepted;
}

function wouldCreateCycle(
  adj: Map<string, Set<string>>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  // DFS from `to` — if we can reach `from`, the new edge from→to closes a cycle.
  const stack: string[] = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = adj.get(node);
    if (next) for (const n of next) stack.push(n);
  }
  return false;
}

// ──────────────────── Merge LLM into heuristic ─────────────────────────

export function mergeAlignments(
  heuristic: Record<string, TaskAlignment>,
  llm: ParsedAlign,
): Record<string, TaskAlignment> {
  const out: Record<string, TaskAlignment> = {};
  for (const [key, base] of Object.entries(heuristic)) out[key] = { ...base };
  for (const { key, priority } of llm.alignments) {
    const base = out[key];
    if (!base) continue;
    if (base.priority === priority) {
      out[key] = { ...base, source: 'agreed' };
    } else {
      out[key] = { taskKey: key, priority, source: 'llm' };
    }
  }
  return out;
}

// ──────────────────── Public entry ─────────────────────────────────────

export interface GoalAlignOptions {
  callable?: AlignCallable;
  signal?: AbortSignal;
  /** When true, throw on LLM failure instead of falling back to the
   *  heuristic baseline. Default `false`. */
  strict?: boolean;
}

/**
 * Produce the final alignment + dependency set. Heuristic baseline
 * always runs. LLM refine is best-effort: parse / call failures roll
 * back to heuristic-only, unless `opts.strict` is set.
 */
export async function alignDecomposition(
  input: GoalAlignInput,
  opts: GoalAlignOptions = {},
): Promise<GoalAlignResult> {
  const heuristic = buildHeuristicAlignment(input.decomposition, input.categorize);
  if (!opts.callable) {
    return { alignments: heuristic, dependencies: [], fallback: false };
  }

  const validKeys = new Set(Object.keys(heuristic));
  if (validKeys.size === 0) {
    return { alignments: heuristic, dependencies: [], fallback: false };
  }

  const prompt = buildGoalAlignPrompt(input);
  let raw;
  try {
    raw = await opts.callable({ prompt, signal: opts.signal });
  } catch (err) {
    if (opts.strict) {
      throw new GoalAlignError(
        'LLM_CALL_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
    return { alignments: heuristic, dependencies: [], fallback: true };
  }

  const parsed = extractJsonBlock(raw.text);
  const coerced = parsed ? coerceLlmAlign(parsed, validKeys) : null;
  if (coerced === null) {
    if (opts.strict) {
      throw new GoalAlignError('PARSE_FAILED', 'no usable alignments', raw.text);
    }
    return { alignments: heuristic, dependencies: [], fallback: true };
  }

  const merged = mergeAlignments(heuristic, coerced);
  const safeDeps = breakCycles(coerced.dependencies);
  return {
    alignments: merged,
    dependencies: safeDeps,
    fallback: false,
    usage: {
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
      costUsd: raw.costUsd,
      modelId: raw.modelId,
    },
  };
}

// Re-export for callers that already imported from goal-align:
export type { TaskCategorization, TaskCategory };
export { isTaskCategory };
