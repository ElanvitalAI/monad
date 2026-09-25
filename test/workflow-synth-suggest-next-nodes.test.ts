// M4-1 (2026-05-12 · Phase 4 N5-1) — context-aware node suggestion tests.
//
// Lock:
//   • buildPrompt — includes workflow summary · position · intent ·
//     catalog kinds (20 종)
//   • parseSuggestionsResponse — fence strip · JSON shape · confidence
//     clamp · malformed throw
//   • suggestNextNodes (integration) — happy path with stub LLM ·
//     LLM error → ok=false · malformed JSON → ok=false

import { describe, expect, it } from 'bun:test';
import {
  buildPrompt,
  extractJsonArray,
  parseSuggestionsResponse,
  suggestNextNodes,
} from '../src/workflow-synth/suggest-next-nodes';
import type { WorkflowDefinition, WorkflowDeps } from '../src/workflow-runtime/types';

function wf(nodes: Array<Record<string, unknown>>): WorkflowDefinition {
  return {
    name: 'wf-test',
    description: 'test',
    nodes: nodes as never,
  };
}

function stubLLM(text: string | (() => string)): Pick<WorkflowDeps, 'callLLM'> {
  return {
    callLLM: async () => typeof text === 'function' ? text() : text,
  };
}

describe('buildPrompt', () => {
  const workflow = wf([
    { id: 'in', chatTrigger: { path: '/c' } },
    { id: 'reply', depends_on: ['in'], prompt: 'hi' },
  ]);

  it('includes workflow name + description + node summary', () => {
    const p = buildPrompt({ workflow, count: 3 });
    expect(p).toContain('name = wf-test');
    expect(p).toContain('- id: in');
    expect(p).toContain('chatTrigger: ...');
    expect(p).toContain('- id: reply');
    expect(p).toContain('depends_on: in');
  });

  it('includes the 20-node catalog kinds', () => {
    const p = buildPrompt({ workflow, count: 3 });
    expect(p).toContain('prompt (core)');
    expect(p).toContain('scheduleTrigger (trigger)');
    expect(p).toContain('chatTrigger (trigger)');
    expect(p).toContain('classify (transform)');
  });

  it('describes the requested position', () => {
    const after = buildPrompt({ workflow, count: 3, position: { kind: 'after', nodeId: 'in' } });
    expect(after).toContain("after node 'in'");
    const before = buildPrompt({ workflow, count: 3, position: { kind: 'before', nodeId: 'reply' } });
    expect(before).toContain("before node 'reply'");
    const parallel = buildPrompt({ workflow, count: 3, position: { kind: 'parallel' } });
    expect(parallel).toContain('parallel to');
    const append = buildPrompt({ workflow, count: 3, position: { kind: 'append' } });
    expect(append).toContain('append at the end');
  });

  it('includes intent when provided', () => {
    const p = buildPrompt({ workflow, count: 3, intent: 'log the result to slack' });
    expect(p).toContain('log the result to slack');
  });

  it('requests N suggestions', () => {
    const p = buildPrompt({ workflow, count: 5 });
    expect(p).toContain('Suggest 5 node(s)');
  });
});

describe('parseSuggestionsResponse', () => {
  it('parses a plain JSON array', () => {
    const raw = JSON.stringify([
      { kind: 'bash', confidence: 0.9, rationale: 'next step', skeleton: '- id: x\n  bash: echo hi' },
    ]);
    const out = parseSuggestionsResponse(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('bash');
    expect(out[0]?.confidence).toBe(0.9);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n[{"kind":"prompt","confidence":0.7,"rationale":"r","skeleton":"s"}]\n```';
    const out = parseSuggestionsResponse(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('prompt');
  });

  it('strips plain ``` fences (no language tag)', () => {
    const raw = '```\n[{"kind":"http","confidence":0.5,"rationale":"r","skeleton":"s"}]\n```';
    expect(parseSuggestionsResponse(raw)[0]?.kind).toBe('http');
  });

  it('clamps confidence to [0, 1]', () => {
    const raw = JSON.stringify([
      { kind: 'a', confidence: 1.5, rationale: '', skeleton: '' },
      { kind: 'b', confidence: -0.3, rationale: '', skeleton: '' },
    ]);
    const out = parseSuggestionsResponse(raw);
    expect(out[0]?.confidence).toBe(1);
    expect(out[1]?.confidence).toBe(0);
  });

  it('defaults missing confidence to 0.5', () => {
    const raw = JSON.stringify([{ kind: 'a', rationale: '', skeleton: '' }]);
    expect(parseSuggestionsResponse(raw)[0]?.confidence).toBe(0.5);
  });

  it('throws on non-array root', () => {
    expect(() => parseSuggestionsResponse('{"kind":"x"}')).toThrow(/JSON array/);
  });

  it('throws on suggestion missing kind', () => {
    expect(() => parseSuggestionsResponse(JSON.stringify([{ rationale: 'no kind' }]))).toThrow(/kind/);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseSuggestionsResponse('not-json')).toThrow();
  });

  // M4-1 robustness — local LLMs (gemma · qwen · llava) drift in
  // two known ways. Both are absorbed without changing the prompt.
  it('accepts kind synonyms (type / name / nodeKind / node_kind)', () => {
    const out = parseSuggestionsResponse(JSON.stringify([
      { type: 'bash', confidence: 0.8, rationale: 'r', skeleton: 's' },
      { name: 'prompt', confidence: 0.6, rationale: 'r', skeleton: 's' },
      { nodeKind: 'http', confidence: 0.5, rationale: 'r', skeleton: 's' },
      { node_kind: 'classify', confidence: 0.4, rationale: 'r', skeleton: 's' },
    ]));
    expect(out.map(s => s.kind)).toEqual(['bash', 'prompt', 'http', 'classify']);
  });

  it('canonical kind wins when both kind and synonym are present', () => {
    const out = parseSuggestionsResponse(JSON.stringify([
      { kind: 'bash', type: 'prompt', confidence: 0.8, rationale: 'r', skeleton: 's' },
    ]));
    expect(out[0]?.kind).toBe('bash');
  });

  it('slices a JSON array out of narration / prose preamble', () => {
    const noisy = 'Sure! Here are 2 suggestions:\n[{"kind":"bash","confidence":0.9,"rationale":"r","skeleton":"s"},{"kind":"prompt","confidence":0.5,"rationale":"r","skeleton":"s"}]\nLet me know if you want more.';
    const out = parseSuggestionsResponse(noisy);
    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe('bash');
  });

  it('extractJsonArray respects strings + escapes (does not break on "]" inside a string)', () => {
    const raw = 'noise [{"k":"a]b","arr":[1,2,3]},{"k":"c"}] tail';
    expect(extractJsonArray(raw)).toBe('[{"k":"a]b","arr":[1,2,3]},{"k":"c"}]');
  });
});

describe('suggestNextNodes · integration with stub LLM', () => {
  const workflow = wf([
    { id: 'in', manualTrigger: {} },
    { id: 'a', depends_on: ['in'], bash: 'echo hi' },
  ]);

  it('returns ok=true with parsed suggestions on happy path', async () => {
    const llmResponse = JSON.stringify([
      { kind: 'bash', confidence: 0.8, rationale: 'log result', skeleton: '- id: log\n  bash: echo done\n  depends_on: [a]' },
      { kind: 'prompt', confidence: 0.6, rationale: 'summarize', skeleton: '- id: sum\n  prompt: |\n    summarize $a.output\n  depends_on: [a]' },
    ]);
    const r = await suggestNextNodes(
      { workflow, position: { kind: 'after', nodeId: 'a' }, count: 2 },
      stubLLM(llmResponse),
    );
    expect(r.ok).toBe(true);
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[0]?.kind).toBe('bash');
    expect(r.suggestions[0]?.confidence).toBe(0.8);
  });

  it('returns ok=false when LLM throws', async () => {
    const r = await suggestNextNodes(
      { workflow },
      { callLLM: async () => { throw new Error('LLM offline'); } },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('LLM offline');
    expect(r.suggestions).toEqual([]);
  });

  it('returns ok=false when LLM responds with malformed JSON', async () => {
    const r = await suggestNextNodes({ workflow }, stubLLM('definitely not json'));
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.suggestions).toEqual([]);
  });

  it('returns empty suggestions when LLM responds with []', async () => {
    const r = await suggestNextNodes({ workflow }, stubLLM('[]'));
    expect(r.ok).toBe(true);
    expect(r.suggestions).toEqual([]);
  });

  it('clamps count to [1, 5]', async () => {
    // count overflow — still calls LLM with clamped value (5).
    // Test verifies the call doesn't reject; we can't observe the
    // prompt directly but can confirm the result still works.
    let promptSeen = '';
    const r = await suggestNextNodes(
      { workflow, count: 100 },
      { callLLM: async (args) => { promptSeen = args.prompt; return '[]'; } },
    );
    expect(r.ok).toBe(true);
    expect(promptSeen).toContain('Suggest 5 node(s)');
  });

  it('forwards model + provider overrides to callLLM', async () => {
    let observed: { model?: string; provider?: string } = {};
    await suggestNextNodes(
      { workflow, model: 'gpt-5', provider: 'openai' },
      {
        callLLM: async (args) => {
          observed = { ...(args.model ? { model: args.model } : {}), ...(args.provider ? { provider: args.provider } : {}) };
          return '[]';
        },
      },
    );
    expect(observed.model).toBe('gpt-5');
    expect(observed.provider).toBe('openai');
  });
});
