// Node-catalog N2.1 (2026-05-11) — classify (LLM intent routing) tests.

import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runWorkflowToCompletion,
  type WorkflowDeps,
  type WorkflowDefinition,
} from '../src/workflow-runtime/index.js';
import { validateWorkflow } from '../src/workflow-runtime/schema.js';
import { pickClass } from '../src/workflow-runtime/nodes/classify.js';

function makeArtifactsDir(): string {
  return mkdtempSync(join(tmpdir(), 'wf-classify-test-'));
}

function makeDeps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    callLLM: async () => 'unknown',
    runBash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...over,
  };
}

describe('pickClass (pure)', () => {
  it('matches an exact class label in the response', () => {
    expect(pickClass('question', ['question', 'command'])).toBe('question');
  });

  it('matches a quoted class label', () => {
    expect(pickClass("I'll pick 'command' here", ['question', 'command'])).toBe('command');
  });

  it('matches case-insensitive word boundary', () => {
    expect(pickClass('Definitely a Question.', ['question', 'command'])).toBe('question');
  });

  it("returns 'unknown' when nothing matches", () => {
    expect(pickClass('I have no idea', ['a', 'b', 'c'])).toBe('unknown');
  });

  it("returns 'unknown' for empty response", () => {
    expect(pickClass('', ['x'])).toBe('unknown');
  });

  it('prefers quoted over substring match', () => {
    // 'request' and 'question' both contain 'que' substring; we want a
    // word-boundary match plus quoting to disambiguate.
    expect(pickClass("class is 'request'", ['question', 'request'])).toBe('request');
  });
});

describe('schema · classify variant', () => {
  it('accepts well-formed classify', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', classify: { input: '$ARGUMENTS', classes: ['a', 'b'] } }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty classes', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', classify: { input: '$ARGUMENTS', classes: [] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('classify.classes'))).toBe(true);
  });

  it('rejects missing input', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', classify: { classes: ['a'] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.endsWith('classify.input'))).toBe(true);
  });

  it('accepts an optional string hint', () => {
    const r = validateWorkflow({
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'route',
        classify: { input: '$ARGUMENTS', classes: ['a'], hint: 'context' },
      }],
    });
    expect(r.ok).toBe(true);
  });
});

describe('executor · classify node', () => {
  it('passes the input + classes to the LLM and emits the picked class', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', classify: { input: '$ARGUMENTS', classes: ['question', 'command'] } },
      ],
    };
    let seenPrompt: string | undefined;
    const deps = makeDeps({
      callLLM: async ({ prompt }) => {
        seenPrompt = prompt;
        return 'question';
      },
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'why is the sky blue?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['route']?.output).toBe('question');
    expect(seenPrompt).toContain('why is the sky blue?');
    expect(seenPrompt).toContain('- question');
    expect(seenPrompt).toContain('- command');
  });

  it("emits 'unknown' when the LLM refuses to commit", async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', classify: { input: '$ARGUMENTS', classes: ['a', 'b'] } },
      ],
    };
    const deps = makeDeps({ callLLM: async () => "Sorry, I can't tell from that input" });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['route']?.output).toBe('unknown');
    expect(outputs['route']?.ok).toBe(true);
  });

  it('routes downstream via `when: $route.output == class`', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', classify: { input: '$ARGUMENTS', classes: ['music', 'movies'] } },
        { id: 'on-music', bash: 'echo took-music', depends_on: ['route'], when: "$route.output == 'music'" },
        { id: 'on-movies', bash: 'echo took-movies', depends_on: ['route'], when: "$route.output == 'movies'" },
      ],
    };
    const deps = makeDeps({
      callLLM: async () => 'music',
      runBash: async (b) => ({ stdout: b, stderr: '', exitCode: 0 }),
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'tell me about Beethoven', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['on-music']?.output).toBe('echo took-music');
    expect(outputs['on-movies']).toBeUndefined();
  });

  it("returns ok=false when callLLM throws", async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [
        { id: 'route', classify: { input: '$ARGUMENTS', classes: ['x'] } },
      ],
    };
    const deps = makeDeps({
      callLLM: async () => { throw new Error('rate limit'); },
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(false);
    expect(outputs['route']?.ok).toBe(false);
    expect(outputs['route']?.error).toContain('rate limit');
  });

  it('retries when LLM throws (v2)', async () => {
    let calls = 0;
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'route',
        classify: {
          input: '$ARGUMENTS',
          classes: ['a', 'b'],
          retries: 2,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => {
        calls++;
        if (calls < 3) throw new Error('rate limit');
        return 'a';
      },
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(true);
    expect(outputs['route']?.output).toBe('a');
    expect(calls).toBe(3);
  });

  it("retries when result is 'unknown' until a class is picked (v2)", async () => {
    let calls = 0;
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'route',
        classify: {
          input: '$ARGUMENTS',
          classes: ['music'],
          retries: 3,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => {
        calls++;
        return calls < 2 ? 'no clear class' : 'music';
      },
    });
    const { outputs } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(outputs['route']?.output).toBe('music');
    expect(calls).toBe(2);
  });

  it('returns ok=false after exhausting retries on throw (v2)', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{
        id: 'route',
        classify: {
          input: '$ARGUMENTS',
          classes: ['a'],
          retries: 2,
          retryDelayMs: 0,
        },
      }],
    };
    const deps = makeDeps({
      callLLM: async () => { throw new Error('persistent error'); },
    });
    const { outputs, ok } = await runWorkflowToCompletion(
      { workflow: wf, arguments: '?', artifactsDir: makeArtifactsDir() },
      deps,
    );
    expect(ok).toBe(false);
    expect(outputs['route']?.error).toContain('persistent error');
  });

  it('reports variant=classify in node_start events', async () => {
    const wf: WorkflowDefinition = {
      name: 'demo',
      description: 'd',
      nodes: [{ id: 'route', classify: { input: '$ARGUMENTS', classes: ['a'] } }],
    };
    const { events } = await runWorkflowToCompletion(
      { workflow: wf, arguments: 'x', artifactsDir: makeArtifactsDir() },
      makeDeps({ callLLM: async () => 'a' }),
    );
    const start = events.find((e) => e.type === 'node_start');
    expect(start && start.type === 'node_start' && start.nodeType).toBe('classify');
  });
});
