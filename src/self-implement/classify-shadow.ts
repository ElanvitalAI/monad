import { executeClassifyNode } from '../workflow-runtime/nodes/classify.js';
import type { ClassifyNode, NodeExecContext, NodeOutput, WorkflowDeps } from '../workflow-runtime/types.js';
import { REWORK_BUDGET_VERDICTS, type ReworkBudgetVerdict } from './run-outcome.js';

export type ClassifyShadowCallLLM = WorkflowDeps['callLLM'];

export interface ClassifyShadowResult {
  picked: ReworkBudgetVerdict | 'unknown';
  ok: boolean;
  durationMs: number;
  error?: string;
}

function isReworkBudgetVerdict(value: unknown): value is ReworkBudgetVerdict {
  return typeof value === 'string' && (REWORK_BUDGET_VERDICTS as readonly string[]).includes(value);
}

export async function classifyReworkBudgetShadow(
  response: string,
  callLLM: ClassifyShadowCallLLM,
): Promise<ClassifyShadowResult> {
  const startedAt = Date.now();
  try {
    const node: ClassifyNode = {
      id: 'rework-budget-shadow',
      classify: {
        input: '$ARGUMENTS',
        classes: [...REWORK_BUDGET_VERDICTS],
      },
    };
    const context: NodeExecContext = {
      arguments: response,
      artifactsDir: '',
      outputs: {},
      resolvedProvider: undefined,
      resolvedModel: undefined,
      toolPolicy: {},
    };
    const deps: WorkflowDeps = {
      callLLM,
      runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    };
    const result: NodeOutput = await executeClassifyNode(node, context, deps);
    const picked = isReworkBudgetVerdict(result.output) ? result.output : 'unknown';
    return {
      picked,
      ok: result.ok,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (error) {
    return {
      picked: 'unknown',
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
