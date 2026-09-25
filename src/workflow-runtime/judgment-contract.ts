import { validateSupervisionCadence } from '../self-implement/supervision-vocabulary.js';
import type { DagNode } from './types.js';

const SUPERVISION_VOCABULARY = new Set([
  'continue',
  'assist',
  'escalate',
  'abandon',
  'complete',
  'defer',
]);

const EXECUTION_CATALOG = new Set([
  'noop',
  'inject-context',
  'provision',
  'escalate-model',
  'extend-budget',
  'stop-wait',
  'terminate',
  'finalize',
  'schedule-recheck',
]);

export function validateJudgmentVerdict(node: DagNode, verdict: string | undefined): string | null {
  if (!node.judgment || node.vocabulary === undefined) return null;
  if (verdict === undefined) return 'judgment result did not declare a verdict required by vocabulary';
  if (!node.vocabulary.includes(verdict)) {
    return `judgment verdict '${verdict}' is not allowed by vocabulary`;
  }
  return null;
}

export function validateJudgmentContract(node: DagNode): string | null {
  if (!node.judgment) return null;

  if (node.cadence !== undefined) {
    const cadence = validateSupervisionCadence(node.cadence);
    if (!cadence.valid) return `cadence '${node.cadence}' is not wired: ${cadence.reason}`;
  }

  for (const verdict of node.vocabulary ?? []) {
    if (!SUPERVISION_VOCABULARY.has(verdict)) {
      return `vocabulary '${verdict}' is not in the supervision vocabulary`;
    }
  }

  for (const execution of node.executions ?? []) {
    if (!EXECUTION_CATALOG.has(execution)) {
      return `execution '${execution}' is not in the execution catalog`;
    }
  }

  return null;
}
