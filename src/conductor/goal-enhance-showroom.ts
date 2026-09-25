// W6 Z9 · Goal Enhancement Showroom — silent 3-lane enrichment.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §4 Z9.

import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from '../task-orchestrator/surfaces/showroom-surface.js';
import { reduceEnhancement, type EnhancedGoal } from './goal-enhance-reducer.js';

export type GoalEnhanceLaneRole = 'clarifier' | 'outcome-definer' | 'constraint-surfacer';

export interface GoalEnhanceInput {
  goal: string;
  /** Ambient context (location / prior runs) appended to every lane prompt. */
  context?: string;
}

export interface GoalEnhanceDeps {
  laneCallable: ShowroomLaneCallable;
  /** Wall-clock budget across all lanes. Default 8s. */
  timeoutMs?: number;
  models?: Partial<Record<GoalEnhanceLaneRole, string>>;
  now?: () => number;
}

export interface GoalEnhanceResult {
  /** True only when all 3 lanes settled before the deadline. */
  enhanced: boolean;
  /** Reduced SMART goal when enhanced=true · original goal preserved otherwise. */
  goal: EnhancedGoal;
  lanes: Array<{ role: GoalEnhanceLaneRole; text: string; modelId?: string }>;
  fallbackReason?: 'timeout' | 'lane-error' | 'no-callable';
}

const DEFAULT_MODELS: Record<GoalEnhanceLaneRole, string> = {
  'clarifier': 'lm-studio/qwen-7b',
  'outcome-definer': 'lm-studio/qwen-7b',
  'constraint-surfacer': 'lm-studio/qwen-7b',
};

const ROLE_PROMPTS: Record<GoalEnhanceLaneRole, string> = {
  'clarifier': [
    'Clarify the goal in one paragraph. Identify any ambiguous noun or verb.',
    'Do NOT add tasks or sub-steps yet — just sharpen the wording.',
  ].join('\n'),
  'outcome-definer': [
    'Define the success outcome in 1-2 lines. What does "done" look like?',
    'Be testable: measurable signal, deadline, or observable change.',
  ].join('\n'),
  'constraint-surfacer': [
    'List the implicit constraints (deadline, scope, resources, dependencies).',
    'One per line, prefix with `- `. Up to 5.',
  ].join('\n'),
};

function buildLanePrompt(role: GoalEnhanceLaneRole, input: GoalEnhanceInput): string {
  const ctx = input.context ? `\n\nContext:\n${input.context}` : '';
  return `${ROLE_PROMPTS[role]}${ctx}\n\nGoal:\n${input.goal}`;
}

export async function runGoalEnhanceShowroom(
  input: GoalEnhanceInput,
  deps: GoalEnhanceDeps,
): Promise<GoalEnhanceResult> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const models = { ...DEFAULT_MODELS, ...(deps.models ?? {}) };
  const roles: GoalEnhanceLaneRole[] = ['clarifier', 'outcome-definer', 'constraint-surfacer'];

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const laneRoleToShowroom = (r: GoalEnhanceLaneRole): 'plan' | 'review' | 'reflect' => {
    if (r === 'clarifier') return 'reflect';
    if (r === 'outcome-definer') return 'plan';
    return 'review';
  };

  const laneRuns = await Promise.allSettled(
    roles.map(async (role) => {
      const out = await deps.laneCallable({
        role: laneRoleToShowroom(role),
        model: models[role],
        prompt: buildLanePrompt(role, input),
        signal: controller.signal,
      });
      return { role, out };
    }),
  );
  clearTimeout(timer);

  const lanes: GoalEnhanceResult['lanes'] = [];
  const settled: Array<{ role: GoalEnhanceLaneRole; out: ShowroomLaneOutput }> = [];
  for (const r of laneRuns) {
    if (r.status === 'fulfilled') {
      settled.push(r.value);
      lanes.push({
        role: r.value.role,
        text: r.value.out.text,
        ...(r.value.out.modelId ? { modelId: r.value.out.modelId } : {}),
      });
    }
  }

  if (timedOut) {
    return {
      enhanced: false,
      goal: { goal: input.goal, smartGoal: input.goal, constraints: [] },
      lanes,
      fallbackReason: 'timeout',
    };
  }
  if (settled.length < roles.length) {
    return {
      enhanced: false,
      goal: { goal: input.goal, smartGoal: input.goal, constraints: [] },
      lanes,
      fallbackReason: 'lane-error',
    };
  }

  const reduced = reduceEnhancement(input.goal, settled);
  return {
    enhanced: true,
    goal: reduced,
    lanes,
  };
}
