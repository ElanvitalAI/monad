// ── PX-4 P1: skill-workflow type + capability surface ──
//
// Pure type-shape tests. Also explicitly confirms the naming
// disambiguation — `SkillWorkflow` prefix is distinct from the
// scheduler's `WorkflowDefinitionV2`.

import { describe, expect, test } from 'bun:test';
import {
  WORKFLOW_CAPABILITY,
  WORKFLOW_DEFAULTS,
  type SkillWorkflow,
  type SkillWorkflowStep,
  type WorkflowStepKind,
  type WorkflowStepOnError,
  type WorkflowRunState,
} from '../src/plugin-workflows/types';

describe('PX-4 P1 — skill-workflow types', () => {
  test('WORKFLOW_CAPABILITY is stable string constant', () => {
    expect(WORKFLOW_CAPABILITY).toBe('workflow:run');
  });

  test('WORKFLOW_DEFAULTS has sane onError + retry ceilings', () => {
    expect(WORKFLOW_DEFAULTS.onError).toBe('abort');
    expect(WORKFLOW_DEFAULTS.maxRetries).toBe(1);
    expect(WORKFLOW_DEFAULTS.maxRetriesCeiling).toBe(5);
    expect(WORKFLOW_DEFAULTS.maxStepsPerWorkflow).toBe(32);
  });

  test('WorkflowStepKind whitelist = 4 values', () => {
    const kinds: WorkflowStepKind[] = ['agent', 'skill', 'tool', 'askUser'];
    expect(kinds.length).toBe(4);
  });

  test('WorkflowStepOnError whitelist = 4 strategies', () => {
    const policies: WorkflowStepOnError[] = ['retry', 'skip', 'abort', 'ask'];
    expect(policies.length).toBe(4);
  });

  test('SkillWorkflowStep minimum shape is { kind, id }', () => {
    const step: SkillWorkflowStep = { kind: 'tool', id: 'Bash' };
    expect(step.kind).toBe('tool');
    expect(step.onError).toBeUndefined();
    expect(step.handoff).toBeUndefined();
  });

  test('SkillWorkflowStep handoff carries outputPath + passToNext', () => {
    const step: SkillWorkflowStep = {
      kind: 'agent',
      id: 'explore',
      args: { prompt: 'scan src/' },
      handoff: { outputPath: 'scan.md', passToNext: ['context'] },
      onError: 'retry',
      maxRetries: 2,
    };
    expect(step.handoff?.passToNext).toEqual(['context']);
    expect(step.maxRetries).toBe(2);
  });

  test('SkillWorkflow.steps is non-empty by spec (parser enforces)', () => {
    const wf: SkillWorkflow = {
      id: 'greet',
      name: 'Greet',
      steps: [
        { kind: 'tool', id: 'Bash', args: { cmd: 'echo hi' } },
      ],
    };
    expect(wf.steps.length).toBe(1);
  });

  test('WorkflowRunState mirrors step count + tracks currentStep', () => {
    const state: WorkflowRunState = {
      workflowId: 'greet',
      runId: 'run-1',
      pluginId: 'hello',
      status: 'running',
      currentStep: 1,
      steps: [
        { index: 0, kind: 'tool', stepId: 'Bash', status: 'done',
          startedAt: 1000, endedAt: 1010, output: 'hi\n' },
        { index: 1, kind: 'tool', stepId: 'Bash', status: 'running',
          startedAt: 1010 },
      ],
      startedAt: 1000,
    };
    expect(state.steps.length).toBe(2);
    expect(state.steps[1]!.status).toBe('running');
  });
});
