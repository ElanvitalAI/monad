/**
 * LLM output schema for `TaskGenerator.decompose()`.
 *
 * We keep validation lightweight — a plain TS guard (not zod) that
 * matches monad's current dependency footprint. The shape mirrors
 * `TaskInit` from `types.ts` but represents a *proposed* task (no
 * id / status / attempt yet; dependencies reference sibling index
 * positions rather than real task ids — resolver turns them into
 * real ids at apply time).
 */
import {
  isTaskSurface,
  isTaskDeterministicCheck,
  TASK_SURFACE_KINDS,
  type TaskSurface,
  type TaskSurfaceKind,
  type TaskPriority,
  type TaskIsolation,
  type TaskAcceptance,
  type TaskDeterministicCheck,
} from './types.js';

// ───────────────────────── Shapes ───────────────────────────────────

export interface ProposedTask {
  /** 0-based index within the current batch. Used to express sibling
   *  dependencies before real ids exist. */
  index: number;
  title: string;
  description?: string;
  surface: TaskSurface;
  /** Indices of siblings this task depends on (strictly < own index). */
  dependsOn?: readonly number[];
  priority?: TaskPriority;
  isolation?: TaskIsolation;
  estimateMs?: number;
  estimateTokens?: number;
  estimateUsd?: number;
  timeoutMs?: number;
  acceptance?: TaskAcceptance;
}

export interface DecomposeProposal {
  tasks: ProposedTask[];
  /** LLM's rationale / plan summary (2-5 sentences). */
  rationale: string;
}

// ───────────────────────── Validator ───────────────────────────────

export interface ProposalValidationError {
  code:
    | 'NOT_OBJECT'
    | 'MISSING_TASKS'
    | 'EMPTY_TASKS'
    | 'TOO_MANY_TASKS'
    | 'MISSING_RATIONALE'
    | 'TASK_SHAPE'
    | 'BAD_DEPENDENCY'
    | 'FORWARD_DEPENDENCY'
    | 'DUPLICATE_INDEX';
  /** Index of the offending task (when applicable). */
  taskIndex?: number;
  message: string;
}

export interface ValidateOptions {
  maxTasks?: number;
  /** Allowed surface kinds — default all 7. Useful for scoping
   *  generator to a subset (e.g. research mode forbids terminal). */
  allowedSurfaces?: readonly TaskSurfaceKind[];
}

/**
 * Validate a parsed proposal. Returns a list of errors — empty list
 * means OK. Caller decides whether to retry / reject / ask user.
 */
export function validateProposal(
  raw: unknown,
  opts: ValidateOptions = {}
): { ok: true; proposal: DecomposeProposal } | { ok: false; errors: ProposalValidationError[] } {
  const maxTasks = opts.maxTasks ?? 15;
  const allowedSurfaces = opts.allowedSurfaces ?? TASK_SURFACE_KINDS;
  const errors: ProposalValidationError[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ code: 'NOT_OBJECT', message: 'proposal must be an object' });
    return { ok: false, errors };
  }
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.tasks)) {
    errors.push({ code: 'MISSING_TASKS', message: 'proposal.tasks must be an array' });
    return { ok: false, errors };
  }
  if (r.tasks.length === 0) {
    errors.push({ code: 'EMPTY_TASKS', message: 'proposal.tasks is empty' });
    return { ok: false, errors };
  }
  if (r.tasks.length > maxTasks) {
    errors.push({
      code: 'TOO_MANY_TASKS',
      message: `proposal has ${r.tasks.length} tasks; max ${maxTasks}`,
    });
  }
  if (typeof r.rationale !== 'string' || r.rationale.length === 0) {
    errors.push({ code: 'MISSING_RATIONALE', message: 'proposal.rationale must be non-empty string' });
  }

  const proposed: ProposedTask[] = [];
  const seenIndices = new Set<number>();

  for (let i = 0; i < r.tasks.length; i++) {
    const t = r.tasks[i] as Record<string, unknown>;
    const idx = typeof t.index === 'number' ? t.index : i;

    if (seenIndices.has(idx)) {
      errors.push({
        code: 'DUPLICATE_INDEX',
        taskIndex: idx,
        message: `duplicate index ${idx}`,
      });
      continue;
    }
    seenIndices.add(idx);

    if (typeof t.title !== 'string' || t.title.length === 0 || t.title.length > 80) {
      errors.push({
        code: 'TASK_SHAPE',
        taskIndex: idx,
        message: `task[${idx}] title missing or > 80 chars`,
      });
      continue;
    }
    if (!isTaskSurface(t.surface)) {
      errors.push({
        code: 'TASK_SHAPE',
        taskIndex: idx,
        message: `task[${idx}] surface invalid tagged union`,
      });
      continue;
    }
    const s = t.surface as TaskSurface;
    if (!allowedSurfaces.includes(s.kind)) {
      errors.push({
        code: 'TASK_SHAPE',
        taskIndex: idx,
        message: `task[${idx}] surface '${s.kind}' not in allowedSurfaces`,
      });
      continue;
    }

    // Dependency validation
    const deps = t.dependsOn;
    if (deps !== undefined) {
      if (!Array.isArray(deps) || deps.some((d) => typeof d !== 'number')) {
        errors.push({
          code: 'BAD_DEPENDENCY',
          taskIndex: idx,
          message: `task[${idx}] dependsOn must be number[]`,
        });
        continue;
      }
      const forward = (deps as number[]).find((d) => d >= idx);
      if (forward !== undefined) {
        errors.push({
          code: 'FORWARD_DEPENDENCY',
          taskIndex: idx,
          message: `task[${idx}] depends on sibling ${forward} (must be < own index)`,
        });
        continue;
      }
    }

    // Acceptance validation
    let acceptance: TaskAcceptance | undefined;
    if (t.acceptance !== undefined) {
      const a = t.acceptance as Record<string, unknown>;
      if (!a || typeof a !== 'object') {
        errors.push({
          code: 'TASK_SHAPE',
          taskIndex: idx,
          message: `task[${idx}] acceptance must be object`,
        });
        continue;
      }
      if (!Array.isArray(a.criteria)) {
        errors.push({
          code: 'TASK_SHAPE',
          taskIndex: idx,
          message: `task[${idx}] acceptance.criteria must be string[]`,
        });
        continue;
      }
      // ★ checks 완화(대표 2026-07-16) — acceptance.checks 는 optional 결정론 보조(exit-code·file-exists…).
      //   malformed(sol/terra 가 자연어 등 비형식으로 냄)여도 전체 proposal 을 거부하지 않고 **drop**(유효한
      //   것만 유지). acceptance 판정 본질은 criteria(자연어·review 페이즈 LLM)+D1 critique 이므로, 형식 위반
      //   checks 하나로 훌륭한 분해를 죽이지 않는다. [[feedback_mission_fabric_llm_logic_balance_2026_07_16]].
      const validChecks = Array.isArray(a.checks)
        ? ((a.checks as unknown[]).filter(isTaskDeterministicCheck) as TaskDeterministicCheck[])
        : undefined;
      acceptance = {
        criteria: a.criteria as string[],
        ...(validChecks && validChecks.length > 0 ? { checks: validChecks } : {}),
      };
    }

    proposed.push({
      index: idx,
      title: t.title,
      description: typeof t.description === 'string' ? t.description : undefined,
      surface: s,
      dependsOn: deps as readonly number[] | undefined,
      priority: t.priority as TaskPriority | undefined,
      isolation: t.isolation as TaskIsolation | undefined,
      estimateMs: typeof t.estimateMs === 'number' ? t.estimateMs : undefined,
      estimateTokens: typeof t.estimateTokens === 'number' ? t.estimateTokens : undefined,
      estimateUsd: typeof t.estimateUsd === 'number' ? t.estimateUsd : undefined,
      timeoutMs: typeof t.timeoutMs === 'number' ? t.timeoutMs : undefined,
      acceptance,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    proposal: { tasks: proposed, rationale: r.rationale as string },
  };
}
