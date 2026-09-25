// HANDOFF §4.4 wire-through — verify the workflow runtime's `provider:`
// field is honored end-to-end (executor → ctx.resolvedProvider →
// prompt.ts → deps.callLLM).
//
// Tests the runtime layer with a mock callLLM that captures its args
// — we don't actually invoke any LLM provider; the goal is to prove
// the `provider` arg flows correctly.

import { describe, expect, it } from 'bun:test';
import {
  runWorkflowToCompletion,
  type WorkflowDefinition,
  type WorkflowDeps,
} from '../src/workflow-runtime/index.js';

interface CallCapture {
  prompt: string;
  model?: string;
  provider?: string;
}

function makeCapturingDeps(captures: CallCapture[], fakeText = 'ok'): WorkflowDeps {
  return {
    callLLM: async ({ prompt, model, provider }) => {
      captures.push({ prompt, model, provider });
      return fakeText;
    },
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

describe('provider wire-through (HANDOFF §4.4)', () => {
  it('workflow-level provider flows to callLLM', async () => {
    const wf: WorkflowDefinition = {
      name: 'test-wf-provider',
      description: 'verifies provider wire',
      provider: 'grok',
      nodes: [
        { id: 'ask', prompt: 'hi' },
      ],
    };
    const captures: CallCapture[] = [];
    const result = await runWorkflowToCompletion(
      { workflow: wf, arguments: '', persistRun: false },
      makeCapturingDeps(captures),
    );
    expect(result.ok).toBe(true);
    expect(captures.length).toBe(1);
    expect(captures[0]!.provider).toBe('grok');
  });

  it('node-level provider overrides workflow-level', async () => {
    const wf: WorkflowDefinition = {
      name: 'test-wf-node-provider',
      description: 'node override',
      provider: 'grok',
      nodes: [
        { id: 'ask', prompt: 'hi', provider: 'gemini' },
      ],
    };
    const captures: CallCapture[] = [];
    await runWorkflowToCompletion(
      { workflow: wf, arguments: '', persistRun: false },
      makeCapturingDeps(captures),
    );
    expect(captures[0]!.provider).toBe('gemini');
  });

  it('provider undefined when neither workflow nor node specifies', async () => {
    const wf: WorkflowDefinition = {
      name: 'test-wf-no-provider',
      description: 'no provider',
      nodes: [
        { id: 'ask', prompt: 'hi' },
      ],
    };
    const captures: CallCapture[] = [];
    await runWorkflowToCompletion(
      { workflow: wf, arguments: '', persistRun: false },
      makeCapturingDeps(captures),
    );
    expect(captures[0]!.provider).toBeUndefined();
  });

  it('model + provider flow together', async () => {
    const wf: WorkflowDefinition = {
      name: 'test-wf-both',
      description: 'both fields',
      provider: 'anthropic',
      model: 'sonnet',
      nodes: [
        { id: 'ask', prompt: 'hi' },
      ],
    };
    const captures: CallCapture[] = [];
    await runWorkflowToCompletion(
      { workflow: wf, arguments: '', persistRun: false },
      makeCapturingDeps(captures),
    );
    expect(captures[0]!.provider).toBe('anthropic');
    expect(captures[0]!.model).toBe('sonnet');
  });

  it('every prompt node in a multi-node workflow gets the same provider when not overridden', async () => {
    const wf: WorkflowDefinition = {
      name: 'test-wf-multi',
      description: 'multi prompt',
      provider: 'openai',
      nodes: [
        { id: 'a', prompt: 'first' },
        { id: 'b', prompt: 'second', depends_on: ['a'] },
      ],
    };
    const captures: CallCapture[] = [];
    await runWorkflowToCompletion(
      { workflow: wf, arguments: '', persistRun: false },
      makeCapturingDeps(captures),
    );
    expect(captures.map((c) => c.provider)).toEqual(['openai', 'openai']);
  });
});
