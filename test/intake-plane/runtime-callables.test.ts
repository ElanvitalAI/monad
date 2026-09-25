// FU-I7a (2026-05-12) — production LLM adapter for the Phase 1 intake
// pipeline. Verifies that buildRealIntakeCallables wires the 4 phases
// to streamLLM (decompose/categorize/align) and to synthWorkflowFromIntent
// (synth) with the right model/provider plumbing.

import { describe, expect, test } from 'bun:test';

import {
  buildRealIntakeCallables,
  type StreamLlmFn,
  type SynthFromIntentFn,
} from '../../src/intake-plane/runtime-callables.ts';

interface StreamLlmCall {
  messages: Array<{ role: string; content: string }>;
  opts?: { model?: string; provider?: { name: string } } | undefined;
}

function makeStreamStub(text: string): { fn: StreamLlmFn; calls: StreamLlmCall[] } {
  const calls: StreamLlmCall[] = [];
  const fn: StreamLlmFn = async (messages, _onChunk, opts) => {
    calls.push({ messages, opts: opts ? { ...(opts.model !== undefined ? { model: opts.model } : {}), ...(opts.provider !== undefined ? { provider: { name: opts.provider.name } } : {}) } : undefined });
    return text;
  };
  return { fn, calls };
}

const FAKE_PROVIDERS = {
  claude: { name: 'claude' },
  openai: { name: 'openai' },
  gemini: { name: 'gemini' },
  grok: { name: 'grok' },
  local: { name: 'local' },
};

const FAKE_RESOLVER = (model?: string): { name: string } => {
  if (model?.startsWith('gpt')) return FAKE_PROVIDERS.openai;
  return FAKE_PROVIDERS.claude;
};

describe('buildRealIntakeCallables — decompose/categorize/align (prompt → text)', () => {
  test('decompose forwards the prompt + returns LLM text', async () => {
    const { fn, calls } = makeStreamStub('{"missions":[]}');
    const callables = buildRealIntakeCallables({
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    const out = await callables.decompose({ prompt: 'decompose this memo' });
    expect(out.text).toBe('{"missions":[]}');
    expect(calls.length).toBe(1);
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'decompose this memo' }]);
  });

  test('categorize uses the same streamLLM seam (independent invocation)', async () => {
    const { fn, calls } = makeStreamStub('{"categorizations":{}}');
    const callables = buildRealIntakeCallables({
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    await callables.categorize({ prompt: 'cat 1' });
    await callables.categorize({ prompt: 'cat 2' });
    expect(calls.length).toBe(2);
    expect(calls[0]!.messages[0]!.content).toBe('cat 1');
    expect(calls[1]!.messages[0]!.content).toBe('cat 2');
  });

  test('align surfaces the resolved provider name as modelId', async () => {
    const { fn } = makeStreamStub('{"alignments":{}}');
    const callables = buildRealIntakeCallables({
      provider: 'openai',
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    const out = await callables.align({ prompt: 'a' });
    expect(out.modelId).toBe('openai');
  });

  test('explicit provider name overrides heuristic resolver', async () => {
    const { fn, calls } = makeStreamStub('text');
    const callables = buildRealIntakeCallables({
      provider: 'gemini',
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    await callables.decompose({ prompt: 'x' });
    expect(calls[0]!.opts?.provider?.name).toBe('gemini');
  });

  test('unknown provider name falls back to heuristic resolver', async () => {
    const { fn, calls } = makeStreamStub('text');
    const callables = buildRealIntakeCallables({
      provider: 'made-up-provider',
      model: 'gpt-5',                  // heuristic → openai
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    await callables.decompose({ prompt: 'x' });
    expect(calls[0]!.opts?.provider?.name).toBe('openai');
  });

  test('model option is forwarded to streamLLM opts', async () => {
    const { fn, calls } = makeStreamStub('text');
    const callables = buildRealIntakeCallables({
      model: 'claude-opus-4-7',
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    await callables.decompose({ prompt: 'x' });
    expect(calls[0]!.opts?.model).toBe('claude-opus-4-7');
  });

  test('abort signal is forwarded to streamLLM', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fn: StreamLlmFn = async (_messages, _onChunk, opts) => {
      receivedSignal = opts?.signal;
      return '';
    };
    const callables = buildRealIntakeCallables({
      streamLLM: fn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: (async () => ({ ok: false })) as SynthFromIntentFn,
    });
    const ac = new AbortController();
    await callables.decompose({ prompt: 'x', signal: ac.signal });
    expect(receivedSignal).toBe(ac.signal);
  });
});

describe('buildRealIntakeCallables — synth (wraps R3 synthWorkflowFromIntent)', () => {
  test('synth calls synthFromIntent with intent + context + preview=true', async () => {
    let captured: Parameters<SynthFromIntentFn>[0] | null = null;
    const synthFn: SynthFromIntentFn = async (opts) => {
      captured = opts;
      return {
        ok: true,
        yaml: 'name: foo\nnodes: []',
        workflowName: 'foo',
        triggerSummary: 'manual',
      };
    };
    const callables = buildRealIntakeCallables({
      streamLLM: (async () => '') as StreamLlmFn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: synthFn,
    });
    const out = await callables.synth({
      taskKey: 'm-1/t-1',
      intent: 'do thing X',
      context: 'mission: m1',
      categorization: { taskKey: 'm-1/t-1', category: 'dev-feature', workflowEligible: true, confidence: 'high' },
      alignment: { taskKey: 'm-1/t-1', priority: 'high', source: 'heuristic' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.yaml).toBe('name: foo\nnodes: []');
      expect(out.workflowName).toBe('foo');
      expect(out.triggerSummary).toBe('manual');
    }
    expect(captured).not.toBeNull();
    expect(captured!.intent).toBe('do thing X');
    expect(captured!.context).toBe('mission: m1');
    expect(captured!.preview).toBe(true);
  });

  test('synth forwards the callLLM adapter to R3 (uses same streamLLM)', async () => {
    const { fn: streamFn, calls } = makeStreamStub('name: foo\nnodes: []');
    const synthFn: SynthFromIntentFn = async (_opts, deps) => {
      const text = await deps.callLLM({
        prompt: 'inner prompt',
        systemPrompt: 'sys prompt',
      });
      return { ok: true, yaml: text };
    };
    const callables = buildRealIntakeCallables({
      streamLLM: streamFn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: synthFn,
    });
    await callables.synth({
      taskKey: 'm-1/t-1',
      intent: 'do X',
      context: '',
      categorization: { taskKey: 'm-1/t-1', category: 'dev-feature', workflowEligible: true, confidence: 'high' },
      alignment: { taskKey: 'm-1/t-1', priority: 'medium', source: 'heuristic' },
    });
    expect(calls.length).toBe(1);
    // System + user message both forwarded into streamLLM.
    expect(calls[0]!.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(calls[0]!.messages[0]!.content).toBe('sys prompt');
    expect(calls[0]!.messages[1]!.content).toBe('inner prompt');
  });

  test('synth failure → { ok:false, error }', async () => {
    const synthFn: SynthFromIntentFn = async () => ({ ok: false, error: 'parse-failed' });
    const callables = buildRealIntakeCallables({
      streamLLM: (async () => '') as StreamLlmFn,
      resolveProvider: FAKE_RESOLVER,
      providers: FAKE_PROVIDERS,
      synthFromIntent: synthFn,
    });
    const out = await callables.synth({
      taskKey: 'm-1/t-1',
      intent: 'do X',
      context: '',
      categorization: { taskKey: 'm-1/t-1', category: 'debug', workflowEligible: false, confidence: 'low' },
      alignment: { taskKey: 'm-1/t-1', priority: 'low', source: 'heuristic' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe('parse-failed');
    }
  });
});
