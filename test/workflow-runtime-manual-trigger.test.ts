// Surface-unification ROADMAP §B6 (2026-05-11) — manual trigger schema
// + maxNodes:1 invariant + executor pass-through.

import { describe, expect, it } from 'bun:test';
import { validateWorkflow, isManualTriggerNode } from '../src/workflow-runtime/schema';
import { executeManualTriggerNode } from '../src/workflow-runtime/nodes/triggers';
import type { ManualTriggerNode, NodeExecContext, WorkflowDeps } from '../src/workflow-runtime/types';

const ctx = {} as NodeExecContext;
const deps = {} as WorkflowDeps;

describe('manualTrigger schema', () => {
  it('accepts a minimal manualTrigger node', () => {
    const def = {
      name: 'manual-min',
      description: 'minimal manual',
      version: 1,
      nodes: [{ id: 'start', manualTrigger: {} }],
    };
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it('accepts manualTrigger with description', () => {
    const def = {
      name: 'manual-desc',
      description: 'with desc',
      version: 1,
      nodes: [{ id: 'start', manualTrigger: { description: 'Click to run' } }],
    };
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it('rejects non-string description', () => {
    const def = {
      name: 'manual-bad-desc',
      description: 'bad',
      version: 1,
      nodes: [{ id: 'start', manualTrigger: { description: 42 } }],
    };
    const r = validateWorkflow(def);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.includes('manualTrigger.description'))).toBe(true);
  });

  it('enforces maxNodes:1 — multiple manual triggers fail', () => {
    const def = {
      name: 'manual-double',
      description: 'double trouble',
      version: 1,
      nodes: [
        { id: 'a', manualTrigger: {} },
        { id: 'b', manualTrigger: { description: 'second' } },
      ],
    };
    const r = validateWorkflow(def);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('at most one manualTrigger'))).toBe(true);
  });
});

describe('isManualTriggerNode', () => {
  it('identifies manualTrigger nodes', () => {
    const n: ManualTriggerNode = { id: 'm', manualTrigger: {} };
    expect(isManualTriggerNode(n)).toBe(true);
  });

  it('rejects other variants', () => {
    expect(isManualTriggerNode({ id: 'b', bash: 'echo hi' } as never)).toBe(false);
  });
});

describe('executeManualTriggerNode', () => {
  it('passes through with kind=manual', async () => {
    const node: ManualTriggerNode = { id: 'start', manualTrigger: {} };
    const r = await executeManualTriggerNode(node, ctx, deps);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ kind: 'manual' });
  });

  it('includes description when set', async () => {
    const node: ManualTriggerNode = { id: 'start', manualTrigger: { description: 'click me' } };
    const r = await executeManualTriggerNode(node, ctx, deps);
    expect(r.output).toEqual({ kind: 'manual', description: 'click me' });
  });
});
