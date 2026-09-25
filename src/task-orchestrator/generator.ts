/**
 * TOX Generator — LLM-driven decomposition of a free-form objective
 * into a DAG of `ProposedTask` nodes.
 *
 * Origin: `내부 문서 `PLAN-session-task-orchestrator-coevolution`` §3.3.
 * Session: TOX-2b (feat/tox-generator).
 *
 * Design:
 *   - The LLM call is **injected** (`DecomposeCallable`) — same DI
 *     pattern as surface adapters. Tests inject a deterministic
 *     mock; production boot wires `src/llm.ts:streamLLMWithTools`
 *     (or a simpler streamLLM path) and fills in the rest.
 *   - Schema validation is delegated to `generator-schema.ts`. On
 *     first failure, the generator retries once with a corrective
 *     error message; second failure → `requiresApproval: true`
 *     escape hatch (caller sees the raw output + errors).
 *   - `requiresApproval` heuristic: budget (>30%), destructive
 *     command pattern, max-tasks cap exceeded, surface monoculture
 *     (>50% same kind when diversity was requested).
 *   - Depth cap (4) prevents infinite regeneration.
 *
 * The generator does NOT mutate the graph. It returns proposed tasks
 * + an applyToken; the caller apply step turns them into real tasks
 * (this lets the UI show the proposal + ask user approval first).
 */
import { buildDecomposePrompt, type DecomposePromptProfile } from './generator-prompt.js';
import {
  validateProposal,
  type DecomposeProposal,
  type ProposalValidationError,
  type ProposedTask,
  type ValidateOptions,
} from './generator-schema.js';
import { TASK_DEFAULTS, type TaskSurfaceKind } from './types.js';

// ───────────────────────── Hard caps ────────────────────────────────

export const DECOMPOSE_MAX_DEPTH = TASK_DEFAULTS.decomposeMaxDepth; // 4
export const DECOMPOSE_DEFAULT_MAX_TASKS = 7;
export const DECOMPOSE_HARD_MAX_TASKS = 15;
export const BUDGET_APPROVAL_RATIO = 0.3;
export const SURFACE_MONOCULTURE_RATIO = 0.5;

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bgit\s+push\s+-f\b/,
  /--force\b/,
  /\bkubectl\s+delete\b/,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
  /\bdd\s+if=/,
];

// ───────────────────────── Public shapes ───────────────────────────

export interface DecomposeCallable {
  (input: {
    prompt: string;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    costUsd?: number;
    tokenUsage?: { input: number; output: number };
    modelId?: string;
  }>;
}

export interface DecomposeInput {
  objective: string;
  context?: {
    priorResults?: Array<{ taskId: string; title: string; output: string }>;
    attachedFiles?: Array<{ path: string; kind: 'doc' | 'code'; summary?: string }>;
    goalSlug?: string;
    activeSummary?: string;
  };
  constraints?: {
    maxTasks?: number;
    /** ★ 확정 아크 수(Intake clarify arcHint 구조화 배선 2026-07-17) — 프롬프트에 아크 구조를 명시. */
    arcCount?: number;
    preferredSurfaces?: TaskSurfaceKind[];
    allowedSurfaces?: TaskSurfaceKind[];
    budgetUsdRemaining?: number;
  };
  /** Optional caller hint about the goal flavour. When set to a
   *  coding/refactor flavour (e.g. PFC `goalKind = 'coding'`), the
   *  decompose prompt appends a recommended-surface section nudging
   *  the LLM toward `acx-session` (AXON P6). Free-form string —
   *  unrecognised values are ignored.
   *
   *  2026-04-28 (AXON P6 wrap-up B1) — added so PFC Conductor can
   *  pass the active goal kind without forcing the generator to
   *  re-classify it. */
  goalKind?: string;
  /** Optional caller profile; absent callers retain the shared mission-fabric prompt contract. */
  promptProfile?: DecomposePromptProfile;
  depth?: number; // default 0
}

export interface DecomposeResult {
  proposal: DecomposeProposal;
  /** Heuristic flag — caller should ask user before apply. */
  requiresApproval: boolean;
  approvalReasons: string[];
  estimatedTotalUsd: number;
  applyToken: string;
  /** Round-trip cost of the generator call itself (not applied tasks). */
  generatorCostUsd?: number;
  generatorTokenUsage?: { input: number; output: number };
  generatorModelId?: string;
  retries: number;
}

export class DecomposeError extends Error {
  constructor(
    public readonly code: 'DEPTH_EXCEEDED' | 'PARSE_FAILED' | 'VALIDATION_FAILED' | 'ABORTED',
    message: string,
    public readonly validationErrors?: ProposalValidationError[],
    public readonly rawText?: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'DecomposeError';
  }
}

// ───────────────────────── Generator ───────────────────────────────

export interface GeneratorOptions {
  callable: DecomposeCallable;
  /** Randomness shim — tests override. */
  randomHex?: (bytes: number) => string;
}

export class TaskGenerator {
  constructor(private readonly opts: GeneratorOptions) {}

  async decompose(
    input: DecomposeInput,
    abort?: { signal?: AbortSignal }
  ): Promise<DecomposeResult> {
    const depth = input.depth ?? 0;
    if (depth >= DECOMPOSE_MAX_DEPTH) {
      throw new DecomposeError(
        'DEPTH_EXCEEDED',
        `depth=${depth} >= cap ${DECOMPOSE_MAX_DEPTH}; atomicize or escalate`
      );
    }

    // ★ 아크 수 확정(Intake clarify arcHint)이면 하드캡을 arc-aware 로 스케일 — 대표 2026-07-17
    //   "아크당 페이즈(4~5)만 제약·아크 총수 리밋 없음". arcCount×5 까지 허용(멀티아크가 15캡에
    //   다시 눌리지 않게). arcCount 없으면 종전 하드캡 유지.
    const arcCount = input.constraints?.arcCount;
    const effectiveHardMax = arcCount && arcCount >= 1
      ? Math.max(DECOMPOSE_HARD_MAX_TASKS, arcCount * 5)
      : DECOMPOSE_HARD_MAX_TASKS;
    // ★ B0 축①(2026-07-18·아크 붕괴 근본수복) — arcCount 확정 시 maxTasks 는 아크 구조에 지배된다.
    //   버그: se-mission-prepare 가 maxTasks=8(기본)을 arcHint 무관하게 넘겨 arcCount=5(20~25페이즈 필요)와
    //   모순 → 생성기가 8캡에 눌려 7페이즈로 붕괴(gradeArcConformance ⚠️). 수복: arcCount 있으면 하한을
    //   arcCount*4 로 끌어올려(아크당 최소 4페이즈) 모순 제거. 사용자 maxTasks 는 arcCount 미지정 때만 지배.
    const requestedMax = input.constraints?.maxTasks ?? DECOMPOSE_DEFAULT_MAX_TASKS;
    const maxTasks = arcCount && arcCount >= 1
      ? Math.min(effectiveHardMax, Math.max(requestedMax, arcCount * 4))
      : Math.min(requestedMax, effectiveHardMax);
    const validateOpts: ValidateOptions = {
      maxTasks,
      allowedSurfaces: input.constraints?.allowedSurfaces,
    };

    // Round 1
    let retries = 0;
    const prompt = buildDecomposePrompt(input, {
      maxTasks,
      ...(arcCount ? { arcCount } : {}),
      ...(input.promptProfile ? { profile: input.promptProfile } : {}),
    });
    let raw = await this.opts.callable({ prompt, signal: abort?.signal });
    let parsed = tryParse(raw.text);
    let validation = parsed
      ? validateProposal(parsed, validateOpts)
      : ({ ok: false as const, errors: [{ code: 'NOT_OBJECT' as const, message: 'JSON parse failed' }] });

    // Round 2 — one retry with corrective prompt
    if (!validation.ok) {
      retries = 1;
      const retryPrompt = buildDecomposePrompt(input, {
        maxTasks,
        ...(arcCount ? { arcCount } : {}),
        ...(input.promptProfile ? { profile: input.promptProfile } : {}),
        retryErrors: validation.errors,
      });
      raw = await this.opts.callable({ prompt: retryPrompt, signal: abort?.signal });
      parsed = tryParse(raw.text);
      validation = parsed
        ? validateProposal(parsed, validateOpts)
        : ({ ok: false as const, errors: [{ code: 'NOT_OBJECT' as const, message: 'JSON parse failed' }] });
    }

    if (!validation.ok) {
      throw new DecomposeError(
        'VALIDATION_FAILED',
        'schema violation after 1 retry',
        validation.errors,
        raw.text
      );
    }

    const proposal = validation.proposal;
    const approval = evaluateApproval(proposal, input, maxTasks);
    const estimatedTotalUsd = proposal.tasks.reduce(
      (s, t) => s + (t.estimateUsd ?? 0),
      0
    );

    return {
      proposal,
      requiresApproval: approval.requiresApproval,
      approvalReasons: approval.reasons,
      estimatedTotalUsd,
      applyToken: this.makeToken(),
      generatorCostUsd: raw.costUsd,
      generatorTokenUsage: raw.tokenUsage,
      generatorModelId: raw.modelId,
      retries,
    };
  }

  private makeToken(): string {
    const fn = this.opts.randomHex ?? defaultRandomHex;
    return `tx-${fn(6)}`;
  }
}

// ───────────────────────── Helpers ─────────────────────────────────

function tryParse(text: string): unknown {
  // Be tolerant: LLM may wrap JSON in fences or prose.
  const trimmed = text.trim();
  // Try fenced block first
  const fenceMatch = trimmed.match(/```(?:json)?\n([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1]! : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to locate a balanced object substring
    const openIdx = candidate.indexOf('{');
    const closeIdx = candidate.lastIndexOf('}');
    if (openIdx >= 0 && closeIdx > openIdx) {
      try {
        return JSON.parse(candidate.slice(openIdx, closeIdx + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function evaluateApproval(
  proposal: DecomposeProposal,
  input: DecomposeInput,
  maxTasks: number
): { requiresApproval: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const totalUsd = proposal.tasks.reduce((s, t) => s + (t.estimateUsd ?? 0), 0);
  const remaining = input.constraints?.budgetUsdRemaining;
  if (remaining !== undefined && remaining > 0) {
    if (totalUsd / remaining > BUDGET_APPROVAL_RATIO) {
      reasons.push(
        `estimated $${totalUsd.toFixed(2)} > ${(BUDGET_APPROVAL_RATIO * 100).toFixed(0)}% of remaining $${remaining.toFixed(2)}`
      );
    }
  }

  // destructive pattern scan
  for (const t of proposal.tasks) {
    const hay = [t.title, t.description, JSON.stringify(t.surface)].join(' ');
    for (const re of DESTRUCTIVE_PATTERNS) {
      if (re.test(hay)) {
        reasons.push(`task[${t.index}] contains destructive pattern: ${re.source}`);
        break;
      }
    }
  }

  if (proposal.tasks.length > maxTasks) {
    reasons.push(`proposal has ${proposal.tasks.length} tasks > maxTasks ${maxTasks}`);
  }

  // Surface monoculture — if diverse surfaces were requested but
  // >50% share a single kind.
  const preferred = input.constraints?.preferredSurfaces;
  if (preferred && preferred.length > 1 && proposal.tasks.length > 2) {
    const byKind = new Map<TaskSurfaceKind, number>();
    for (const t of proposal.tasks) {
      byKind.set(t.surface.kind, (byKind.get(t.surface.kind) ?? 0) + 1);
    }
    const dominant = Math.max(...byKind.values());
    if (dominant / proposal.tasks.length > SURFACE_MONOCULTURE_RATIO) {
      reasons.push('surface monoculture — >50% tasks on single kind despite diverse preferredSurfaces');
    }
  }

  return { requiresApproval: reasons.length > 0, reasons };
}

function defaultRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Re-export the proposal types so callers don't need two imports.
export type { DecomposeProposal, ProposedTask, ProposalValidationError };
