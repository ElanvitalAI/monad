// H6 P2 Bundle 2 D · Ollama embodied adapter tests (local + remote).
//
// Mirrors test/agent-local-llm-pty-adapter.test.ts and agent-local-llm-
// ssh-pty-adapter.test.ts. Covers supports matrix, argv composition
// (`ollama run <m>` local · `ssh -t <n> ollama run <m>` remote), binary/
// defaultArgs override, and registry wiring.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  createLocalLlmOllamaPtyAdapter,
  registerDefaultLocalLlmOllamaPtyAdapter,
} from '../src/agent/adapters/local-llm-ollama-pty.js';
import {
  createLocalLlmOllamaSshPtyAdapter,
  registerDefaultLocalLlmOllamaSshPtyAdapter,
} from '../src/agent/adapters/local-llm-ollama-ssh-pty.js';
import { AdapterRegistry } from '../src/agent/adapter-registry.js';
import {
  resetForTesting,
  setPtyAdapterForTesting,
  type StartOpts,
} from '../src/pty-shell/registry.js';

function installCapturingPty(): { captured: StartOpts[] } {
  const captured: StartOpts[] = [];
  setPtyAdapterForTesting((opts) => {
    captured.push(opts);
    return {
      pid: 8888,
      write() {},
      kill() {},
      onData() { return { dispose() {} }; },
      onExit() { return { dispose() {} }; },
    };
  });
  return { captured };
}

afterEach(() => {
  resetForTesting();
  setPtyAdapterForTesting(null);
});

describe('createLocalLlmOllamaPtyAdapter (local) · supports()', () => {
  test('matches local-llm-ollama + llo brand', () => {
    const a = createLocalLlmOllamaPtyAdapter();
    expect(a.id).toBe('local-llm-ollama-pty');
    expect(a.supports({ brand: 'local-llm-ollama' })).toBe(true);
    expect(a.supports({ brand: 'llo' })).toBe(true);
    expect(a.supports({ brand: 'local-llm-ollama', mode: 'pty-direct' })).toBe(true);
  });

  test('rejects LM Studio brand and unrelated brands', () => {
    const a = createLocalLlmOllamaPtyAdapter();
    expect(a.supports({ brand: 'local-llm' })).toBe(false);
    expect(a.supports({ brand: 'lll' })).toBe(false);
    expect(a.supports({ brand: 'codex' })).toBe(false);
    expect(a.supports({ brand: 'local-llm-ollama', mode: 'acp' })).toBe(false);
  });
});

describe('createLocalLlmOllamaPtyAdapter (local) · launch()', () => {
  test('composes `ollama run <model>` from extraArgs', async () => {
    const { captured } = installCapturingPty();
    const a = createLocalLlmOllamaPtyAdapter();
    const session = await a.launch({
      brand: 'local-llm-ollama',
      extraArgs: ['llama3.1:8b'],
    });
    expect(session.id).toMatch(/^emb-local-llm-ollama-pty-/);
    expect(session.transports[0]!.label).toBe('local-llm-ollama-pty');
    expect(captured[0]!.cmd).toBe('ollama');
    expect(captured[0]!.args).toEqual(['run', 'llama3.1:8b']);
    await session.dispose();
  });

  test('custom binary override', async () => {
    const { captured } = installCapturingPty();
    const a = createLocalLlmOllamaPtyAdapter({ binary: '/opt/homebrew/bin/ollama' });
    await a.launch({ brand: 'llo', extraArgs: ['qwen2.5:7b'] });
    expect(captured[0]!.cmd).toBe('/opt/homebrew/bin/ollama');
    expect(captured[0]!.args).toEqual(['run', 'qwen2.5:7b']);
  });
});

describe('createLocalLlmOllamaSshPtyAdapter (remote) · supports()', () => {
  test('matches local-llm-ollama-remote + llo-remote brand', () => {
    const a = createLocalLlmOllamaSshPtyAdapter();
    expect(a.id).toBe('local-llm-ollama-ssh-pty');
    expect(a.supports({ brand: 'local-llm-ollama-remote' })).toBe(true);
    expect(a.supports({ brand: 'llo-remote' })).toBe(true);
  });

  test('rejects local Ollama brand', () => {
    const a = createLocalLlmOllamaSshPtyAdapter();
    expect(a.supports({ brand: 'local-llm-ollama' })).toBe(false);
    expect(a.supports({ brand: 'llo' })).toBe(false);
  });
});

describe('createLocalLlmOllamaSshPtyAdapter (remote) · launch()', () => {
  test('composes `ssh -t <node> ollama run <model>` from extraArgs', async () => {
    const { captured } = installCapturingPty();
    const a = createLocalLlmOllamaSshPtyAdapter();
    const session = await a.launch({
      brand: 'local-llm-ollama-remote',
      extraArgs: ['node-b', 'ollama', 'run', 'llama3.1:70b'],
    });
    expect(session.transports[0]!.label).toBe('local-llm-ollama-pty-remote');
    expect(captured[0]!.cmd).toBe('ssh');
    expect(captured[0]!.args).toEqual(['-t', 'node-b', 'ollama', 'run', 'llama3.1:70b']);
    await session.dispose();
  });
});

describe('registry wiring', () => {
  test('pick() routes local brand to local adapter · remote brand to remote adapter', () => {
    const r = new AdapterRegistry();
    registerDefaultLocalLlmOllamaPtyAdapter(r);
    registerDefaultLocalLlmOllamaSshPtyAdapter(r);
    expect(r.pick({ brand: 'local-llm-ollama' })?.id).toBe('local-llm-ollama-pty');
    expect(r.pick({ brand: 'llo' })?.id).toBe('local-llm-ollama-pty');
    expect(r.pick({ brand: 'local-llm-ollama-remote' })?.id).toBe('local-llm-ollama-ssh-pty');
    expect(r.pick({ brand: 'llo-remote' })?.id).toBe('local-llm-ollama-ssh-pty');
    // LM Studio brands don't match.
    expect(r.pick({ brand: 'local-llm' })).toBeUndefined();
    expect(r.pick({ brand: 'local-llm-remote' })).toBeUndefined();
  });
});
