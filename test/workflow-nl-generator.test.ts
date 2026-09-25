// ROADMAP Tier 1 W1 — tests for src/workflow/nl-generator.ts.
//
// The generator has 3 axes worth covering:
//   - happy path: clean JSON in → valid YAML out (no warnings)
//   - JSON extraction tolerance: fenced response / surrounding prose
//   - validation surfacing: bad LLM output → warnings reported, raw kept
//
// All tests use a stub `GeneratorLLMCaller` so this suite stays pure
// (no network · no LLM API key · runs in <100ms).

import { describe, expect, test } from 'bun:test';
import {
  extractWorkflowJson,
  generateWorkflow,
  type GeneratorLLMCaller,
} from '../src/workflow/nl-generator.js';
import { parse as parseYaml } from 'yaml';

const HAPPY_JSON = JSON.stringify({
  name: 'summarize-link',
  description: 'Pulls a URL through omni-digest and confirms delivery.',
  model: 'haiku',
  nodes: [
    { id: 'digest', skill: 'omni-digest', arguments: '$ARGUMENTS' },
    { id: 'confirm', bash: "echo 'done'", depends_on: ['digest'] },
  ],
});

function makeStub(response: string): GeneratorLLMCaller {
  return async () => response;
}

describe('extractWorkflowJson', () => {
  test('parses raw JSON directly', () => {
    expect(extractWorkflowJson('{"a":1}')).toEqual({ a: 1 });
  });

  test('strips ```json fences', () => {
    const text = 'Here you go:\n```json\n{"name":"x"}\n```';
    expect(extractWorkflowJson(text)).toEqual({ name: 'x' });
  });

  test('strips ```yaml fences (some LLMs wrap output that way)', () => {
    // We accept yaml fences too — extractWorkflowJson tries JSON parse
    // first; if the body inside the fence is JSON-shaped it parses.
    const text = '```yaml\n{"hi":"there"}\n```';
    expect(extractWorkflowJson(text)).toEqual({ hi: 'there' });
  });

  test('locates JSON inside surrounding prose via balanced braces', () => {
    const text = 'Sure! { "x": 1, "y": { "z": 2 } } — let me know if you want changes.';
    expect(extractWorkflowJson(text)).toEqual({ x: 1, y: { z: 2 } });
  });

  test('returns null for non-JSON text', () => {
    expect(extractWorkflowJson('I cannot help with that.')).toBeNull();
  });

  test('returns null for malformed JSON', () => {
    expect(extractWorkflowJson('{ name: bad }')).toBeNull();
  });

  test('returns null for empty / non-string input', () => {
    expect(extractWorkflowJson('')).toBeNull();
    expect(extractWorkflowJson(undefined as unknown as string)).toBeNull();
  });

  test('rejects JSON arrays (workflow root must be an object)', () => {
    expect(extractWorkflowJson('[1,2,3]')).toBeNull();
  });
});

describe('generateWorkflow happy path', () => {
  test('clean JSON in → valid YAML + no warnings + parsed definition', async () => {
    const res = await generateWorkflow({ prompt: 'summarize a link' }, makeStub(HAPPY_JSON));
    expect(res.warnings).toEqual([]);
    expect(res.definition).toBeDefined();
    expect(res.definition?.name).toBe('summarize-link');
    expect(res.definition?.nodes.length).toBe(2);
    // YAML round-trips: re-parsing should produce the same shape.
    const reparsed = parseYaml(res.yaml) as { name: string; nodes: unknown[] };
    expect(reparsed.name).toBe('summarize-link');
    expect(reparsed.nodes.length).toBe(2);
  });

  test('passes model + provider to the LLM caller', async () => {
    const captured: { model?: string; provider?: string } = {};
    const stub: GeneratorLLMCaller = async (_sys, _user, opts) => {
      captured.model = opts.model;
      captured.provider = opts.provider;
      return HAPPY_JSON;
    };
    await generateWorkflow(
      { prompt: 'summarize a link', model: 'haiku', provider: 'anthropic' },
      stub,
    );
    expect(captured.model).toBe('haiku');
    expect(captured.provider).toBe('anthropic');
  });

  test('skills are injected into the user prompt', async () => {
    const captured: { systemPrompt?: string; userPrompt?: string } = {};
    const stub: GeneratorLLMCaller = async (sys, user) => {
      captured.systemPrompt = sys;
      captured.userPrompt = user;
      return HAPPY_JSON;
    };
    await generateWorkflow(
      { prompt: 'do thing', skills: ['omni-digest', 'omni-crawl'] },
      stub,
    );
    expect(captured.userPrompt).toContain('omni-digest');
    expect(captured.userPrompt).toContain('omni-crawl');
    // System prompt is fixed — sanity-check the schema is mentioned.
    expect(captured.systemPrompt).toContain('kebab-case');
  });

  test('refinement mode includes the current yaml + instruction', async () => {
    const captured: { userPrompt?: string } = {};
    const stub: GeneratorLLMCaller = async (_sys, user) => {
      captured.userPrompt = user;
      return HAPPY_JSON;
    };
    await generateWorkflow(
      {
        prompt: 'add a slack notification at the end',
        currentYaml: 'name: foo\ndescription: bar\nnodes:\n  - id: a\n    bash: echo\n',
      },
      stub,
    );
    expect(captured.userPrompt).toContain('Existing workflow YAML to refine:');
    expect(captured.userPrompt).toContain('Refinement request: add a slack');
  });
});

describe('generateWorkflow validation surfacing', () => {
  test('non-JSON LLM response → warnings + empty yaml + raw kept', async () => {
    const stub = makeStub("I'm afraid I cannot help with that.");
    const res = await generateWorkflow({ prompt: 'do thing' }, stub);
    expect(res.yaml).toBe('');
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings[0]).toContain('did not contain a JSON');
    expect(res.raw).toBe("I'm afraid I cannot help with that.");
    expect(res.definition).toBeUndefined();
  });

  test('invalid workflow shape → warnings carry validation issues', async () => {
    // Missing required `description` + bad node (no variant fields).
    const badJson = JSON.stringify({
      name: 'bad-wf',
      nodes: [{ id: 'orphan' }],
    });
    const res = await generateWorkflow({ prompt: 'do thing' }, makeStub(badJson));
    // YAML still produced — caller can edit it.
    expect(res.yaml.length).toBeGreaterThan(0);
    expect(res.warnings.length).toBeGreaterThan(0);
    // Validation should flag the missing description at minimum.
    expect(res.warnings.some((w) => /description/.test(w))).toBe(true);
    expect(res.definition).toBeUndefined();
  });

  test('empty prompt → fast-path warning, no LLM call', async () => {
    let called = 0;
    const stub: GeneratorLLMCaller = async () => {
      called++;
      return HAPPY_JSON;
    };
    const res = await generateWorkflow({ prompt: '   ' }, stub);
    expect(called).toBe(0);
    expect(res.warnings).toEqual(['prompt is required']);
    expect(res.yaml).toBe('');
  });
});
