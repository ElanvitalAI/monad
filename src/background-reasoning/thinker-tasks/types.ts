// W6 Y4 · shared types for thinker-tasks. Cf. ROADMAP §4.

import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface KgsCardRef {
  /** KGS card id (sqlite-store rowid or external uuid). */
  id: string;
  /** Card kind v2 (`playbook` · `incident` · `retrospective` · ...). */
  kind: string;
  /** Coarse content excerpt for prompt context. */
  excerpt: string;
  /** ISO timestamp (UTC). */
  ts: string;
}

export interface RoutineSnapshot {
  /** Rolling 30-day window aggregated routine signals. */
  events: Array<{ kind: string; count: number; lastTs: string }>;
}

export interface IntentFeedback {
  intentKind: string;
  outcome: 'success' | 'fail' | 'ignored';
  ts: string;
}

export interface ThinkerLlmInput {
  prompt: string;
  modelSpec: ThinkerModelSpec;
  longContext?: boolean;
  signal?: AbortSignal;
}

export interface ThinkerLlmOutput {
  text: string;
  modelId?: string;
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
}

export interface ThinkerLlmCallable {
  (input: ThinkerLlmInput): Promise<ThinkerLlmOutput>;
}

export type ThinkerOutput =
  | { kind: 'workflow_proposal'; yaml: string; rationale: string }
  | { kind: 'template_draft'; omf: Record<string, unknown>; rationale: string }
  | { kind: 'mission_decision'; missionId: string; decision: string; rationale: string }
  | { kind: 'prompt_patch'; target: 'skill' | 'persona'; targetName: string; patch: string; rationale: string }
  | { kind: 'next_action_predict'; top5: Array<{ kind: string; score: number; rationale?: string }> }
  | { kind: 'personalization_update'; target: string; update: Record<string, unknown> }
  | { kind: 'cross_workflow_pattern'; affected: string[]; suggestion: string };
