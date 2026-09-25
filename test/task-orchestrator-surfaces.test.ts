import { describe, expect, test } from 'bun:test';
import { createLlmDirectAdapter } from '../src/task-orchestrator/surfaces/llm-direct.js';
import { createSkillAdapter } from '../src/task-orchestrator/surfaces/skill.js';
import { createChatPromptAdapter } from '../src/task-orchestrator/surfaces/chat-prompt.js';
import { createTask, type Task, type TaskSurface } from '../src/task-orchestrator/types.js';

function mkTask(id: string, surface: TaskSurface): Task {
  return createTask({ title: `t-${id}`, surface }, { id: `task:${id}` });
}

// ───────────────────── llm-direct adapter ─────────────────────

describe('llm-direct adapter', () => {
  test('resolves with completed + output + cost', async () => {
    const adapter = createLlmDirectAdapter({
      callable: async () => ({
        text: 'the answer is 42',
        tokenUsage: { input: 100, output: 20 },
        costUsd: 0.002,
        modelId: 'claude-haiku-4-5',
      }),
    });
    const t = mkTask('a', { kind: 'llm-direct', prompt: 'what is the answer?' });
    const res = await adapter(t, {});
    const exec = await res.promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('the answer is 42');
    expect(exec.tokenUsage).toEqual({ input: 100, output: 20 });
    expect(exec.costUsd).toBe(0.002);
    expect(exec.modelId).toBe('claude-haiku-4-5');
  });

  test('throws resolves to failed with LLM_FAILED', async () => {
    const adapter = createLlmDirectAdapter({
      callable: async () => {
        throw new Error('network down');
      },
    });
    const t = mkTask('e', { kind: 'llm-direct', prompt: 'x' });
    const res = await adapter(t, {});
    const exec = await res.promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('LLM_FAILED');
    expect(exec.error?.message).toContain('network down');
  });

  test('abort signal → cancelled status', async () => {
    const ctrl = new AbortController();
    const adapter = createLlmDirectAdapter({
      callable: async (input) => {
        // Reject because the signal aborted before completion
        return new Promise((_, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    });
    const t = mkTask('c', { kind: 'llm-direct', prompt: 'x' });
    const res = await adapter(t, { signal: ctrl.signal });
    ctrl.abort();
    const exec = await res.promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('ABORTED');
  });

  test('model resolution: task.surface.model wins over ctx.modelHint', async () => {
    let seenModel: string | undefined;
    const adapter = createLlmDirectAdapter({
      callable: async (input) => {
        seenModel = input.model;
        return { text: '' };
      },
    });
    const t = mkTask('m', {
      kind: 'llm-direct',
      prompt: 'x',
      model: 'claude-opus-4-7',
    });
    await (await adapter(t, { modelHint: 'gpt-4o' })).promise;
    expect(seenModel).toBe('claude-opus-4-7');
  });

  test('model resolution fallback to ctx.modelHint', async () => {
    let seenModel: string | undefined;
    const adapter = createLlmDirectAdapter({
      callable: async (input) => {
        seenModel = input.model;
        return { text: '' };
      },
    });
    const t = mkTask('h', { kind: 'llm-direct', prompt: 'x' });
    await (await adapter(t, { modelHint: 'gemini-2.5-flash' })).promise;
    expect(seenModel).toBe('gemini-2.5-flash');
  });

  test('wrong surface kind throws', async () => {
    const adapter = createLlmDirectAdapter({
      callable: async () => ({ text: '' }),
    });
    const t = mkTask('w', { kind: 'skill', skillName: 'x' });
    await expect(adapter(t, {})).rejects.toThrow(/wrong kind/);
  });
});

// ───────────────────── skill adapter ─────────────────────

describe('skill adapter', () => {
  test('exit 0 → completed', async () => {
    const adapter = createSkillAdapter({
      callable: async () => ({ stdout: 'done', exitCode: 0, durationMs: 100 }),
    });
    const t = mkTask('s', { kind: 'skill', skillName: 'omni-crawl' });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toBe('done');
    expect(exec.durationMs).toBe(100);
    expect(exec.surfaceAddress).toBe('skill:omni-crawl');
  });

  test('exit non-zero → failed with EXIT_N code', async () => {
    const adapter = createSkillAdapter({
      callable: async () => ({ stdout: '', exitCode: 42, durationMs: 50 }),
    });
    const t = mkTask('f', { kind: 'skill', skillName: 'broken' });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('EXIT_42');
  });

  test('spawn error → SKILL_SPAWN_FAILED', async () => {
    const adapter = createSkillAdapter({
      callable: async () => {
        throw new Error('ENOENT');
      },
    });
    const t = mkTask('n', { kind: 'skill', skillName: 'missing' });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('SKILL_SPAWN_FAILED');
  });

  test('args passed through', async () => {
    let seenArgs: Record<string, unknown> | undefined;
    const adapter = createSkillAdapter({
      callable: async (input) => {
        seenArgs = input.args;
        return { stdout: 'ok', exitCode: 0, durationMs: 1 };
      },
    });
    const t = mkTask('a', { kind: 'skill', skillName: 'omni-crawl', args: { query: 'xyz' } });
    await (await adapter(t, {})).promise;
    expect(seenArgs).toEqual({ query: 'xyz' });
  });
});

// ───────────────────── chat-prompt adapter ─────────────────────

describe('chat-prompt adapter', () => {
  test('user answers → completed with serialised answers', async () => {
    const adapter = createChatPromptAdapter({
      callable: async () => ({
        answers: { q1: 'Yes' },
      }),
    });
    const t = mkTask('p', {
      kind: 'chat-prompt',
      question: { header: 'H', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] },
    });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('completed');
    expect(exec.output).toContain('Yes');
  });

  test('cancelled answer → cancelled status', async () => {
    const adapter = createChatPromptAdapter({
      callable: async () => ({
        answers: {},
        cancelled: true,
      }),
    });
    const t = mkTask('c', {
      kind: 'chat-prompt',
      question: { header: 'H', question: 'Q', options: [{ label: 'a' }] },
    });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('cancelled');
    expect(exec.error?.code).toBe('USER_CANCELLED');
  });

  test('otherText included in output', async () => {
    const adapter = createChatPromptAdapter({
      callable: async () => ({
        answers: { q1: 'Other' },
        otherText: 'custom answer',
      }),
    });
    const t = mkTask('o', {
      kind: 'chat-prompt',
      question: { header: 'H', question: 'Q', options: [{ label: 'Other' }], includeOther: true },
    });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.output).toContain('custom answer');
  });

  test('exception → failed', async () => {
    const adapter = createChatPromptAdapter({
      callable: async () => {
        throw new Error('modal router busy');
      },
    });
    const t = mkTask('x', {
      kind: 'chat-prompt',
      question: { header: 'H', question: 'Q', options: [] },
    });
    const exec = await (await adapter(t, {})).promise;
    expect(exec.status).toBe('failed');
    expect(exec.error?.code).toBe('CHAT_PROMPT_FAILED');
  });
});
