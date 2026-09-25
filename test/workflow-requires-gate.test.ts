// RFC #2161 Phase 3 — workflow runtime `requires` gate behaviour.

import { describe, expect, it } from 'bun:test';
import { runWorkflowToCompletion } from '../src/workflow-runtime/executor.js';
import { validateWorkflow } from '../src/workflow-runtime/schema.js';
import type {
  WorkflowDefinition,
  WorkflowDeps,
} from '../src/workflow-runtime/types.js';

function neverDeps(): WorkflowDeps {
  return {
    callLLM: async () => 'should not be called',
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

function loggingDeps(): { deps: WorkflowDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      callLLM: async ({ prompt }) => {
        calls.push(`llm:${prompt}`);
        return 'ok';
      },
      runBash: async (body) => {
        calls.push(`bash:${body}`);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}

describe('schema · validate `requires` shape', () => {
  it('accepts a valid requires block on a prompt node', () => {
    const result = validateWorkflow({
      name: 'wf',
      description: 'd',
      nodes: [
        {
          id: 'analyze',
          prompt: 'p',
          requires: {
            vision: 'images',
            mcp: true,
            reasoning: 'high',
            minContextSize: 100_000,
            toolCalling: 'native-anthropic',
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown requires key (typo guard)', () => {
    const result = validateWorkflow({
      name: 'wf',
      description: 'd',
      nodes: [{ id: 'a', prompt: 'p', requires: { reasoing: 'high' } }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.path === 'nodes[0].requires.reasoing')).toBeTruthy();
  });

  it('rejects non-boolean for capability flag', () => {
    const result = validateWorkflow({
      name: 'wf',
      description: 'd',
      nodes: [{ id: 'a', prompt: 'p', requires: { mcp: 'yes' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid vision value', () => {
    const result = validateWorkflow({
      name: 'wf',
      description: 'd',
      nodes: [{ id: 'a', prompt: 'p', requires: { vision: 'audio' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects minContextSize as negative', () => {
    const result = validateWorkflow({
      name: 'wf',
      description: 'd',
      nodes: [{ id: 'a', prompt: 'p', requires: { minContextSize: -1 } }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('executor · `requires` gate', () => {
  it('blocks the node when resolved model lacks the required capability', async () => {
    const workflow: WorkflowDefinition = {
      name: 'gate-block',
      description: 'd',
      nodes: [
        {
          id: 'analyze',
          prompt: 'analyze the image',
          provider: 'openai',
          model: 'gpt-5.5',
          // openai capabilities lack 'mcp' in the bundled catalog · the
          // gate fires with a precise capability-mismatch reason before
          // the LLM call would otherwise burn budget.
          requires: { mcp: true },
        } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok, events, outputs } = await runWorkflowToCompletion(
      { workflow, arguments: '' },
      deps,
    );
    expect(ok).toBe(false);
    expect(calls.length).toBe(0); // gate fired BEFORE the LLM call
    expect(outputs.analyze?.ok).toBe(false);
    expect(outputs.analyze?.error).toContain("does not satisfy capability 'mcp'");
    expect(events.some((e) => e.type === 'workflow_failed')).toBe(true);
  });

  it('passes through when capability satisfied', async () => {
    const workflow: WorkflowDefinition = {
      name: 'gate-pass',
      description: 'd',
      nodes: [
        {
          id: 'analyze',
          prompt: 'analyze',
          provider: 'anthropic',
          model: 'claude-opus-4-7',
          // anthropic.yaml advertises thinkingControl + claude-opus-4-7
          // ships vision='images' — both present in bundled catalog.
          requires: { thinkingControl: true, vision: 'images' },
        } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok, outputs } = await runWorkflowToCompletion(
      { workflow, arguments: '' },
      deps,
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(['llm:analyze']);
    expect(outputs.analyze?.ok).toBe(true);
  });

  it('blocks vision mismatch with a precise reason', async () => {
    const workflow: WorkflowDefinition = {
      name: 'vision-block',
      description: 'd',
      nodes: [
        {
          id: 'video',
          prompt: 'p',
          provider: 'anthropic',
          model: 'claude-opus-4-7', // accepts vision: 'images', not 'video'
          requires: { vision: 'video' },
        } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok, outputs } = await runWorkflowToCompletion(
      { workflow, arguments: '' },
      deps,
    );
    expect(ok).toBe(false);
    expect(calls.length).toBe(0);
    expect(outputs.video?.error).toContain("does not accept vision input 'video'");
  });

  it('skips gate when requires is undefined (backward compat)', async () => {
    const workflow: WorkflowDefinition = {
      name: 'no-requires',
      description: 'd',
      nodes: [
        { id: 'a', prompt: 'p', provider: 'openai', model: 'gpt-5.5' } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok } = await runWorkflowToCompletion({ workflow, arguments: '' }, deps);
    expect(ok).toBe(true);
    expect(calls).toEqual(['llm:p']);
  });

  it('skips gate when no model resolved (default flow falls back)', async () => {
    const workflow: WorkflowDefinition = {
      name: 'no-model',
      description: 'd',
      // workflow has no top-level provider/model and the node only
      // declares requires — the gate should not fire (Phase 5 closes
      // this gap with Live Registry default resolution).
      nodes: [
        { id: 'a', prompt: 'p', requires: { mcp: true } } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok } = await runWorkflowToCompletion({ workflow, arguments: '' }, deps);
    expect(ok).toBe(true);
    expect(calls).toEqual(['llm:p']);
  });

  it('downstream all_done node still runs after gate block', async () => {
    const workflow: WorkflowDefinition = {
      name: 'all-done-passes',
      description: 'd',
      nodes: [
        {
          id: 'a',
          prompt: 'a',
          provider: 'openai',
          model: 'gpt-5.5',
          requires: { mcp: true },
        } as never,
        {
          id: 'b',
          bash: 'echo hi',
          depends_on: ['a'],
          trigger_rule: 'all_done',
        } as never,
      ],
    };
    const { deps, calls } = loggingDeps();
    const { ok, outputs } = await runWorkflowToCompletion(
      { workflow, arguments: '' },
      deps,
    );
    expect(ok).toBe(true);
    expect(outputs.a?.ok).toBe(false);
    expect(outputs.b?.ok).toBe(true);
    expect(calls).toEqual(['bash:echo hi']);
  });

  it('never deps reach the gate path because gate fires before dispatch', async () => {
    const workflow: WorkflowDefinition = {
      name: 'never-deps',
      description: 'd',
      nodes: [
        {
          id: 'analyze',
          prompt: 'p',
          provider: 'openai',
          model: 'gpt-5.5',
          requires: { mcp: true },
        } as never,
      ],
    };
    // If the gate fails to fire, callLLM throws — that's the strongest
    // evidence the gate ran first.
    const result = await runWorkflowToCompletion(
      { workflow, arguments: '' },
      neverDeps(),
    );
    expect(result.ok).toBe(false);
  });
});
