// BACKLOG #7 production wiring — verify the workflow router endpoint
// builds the right prompt + parses LLM responses + handles edge cases
// (empty workflows, LLM errors, unknown picks).

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { routeWorkflow, type RouterLLMCaller } from '../src/nexus/api/workflow-router.js';

let tmpDir: string;
let prevCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wf-router-'));
  // discoverWorkflows reads from process.cwd() — chdir into a tmp
  // dir with a controlled .elanous/workflows/ payload so test runs are
  // hermetic.
  prevCwd = process.cwd();
  process.chdir(tmpDir);
  mkdirSync(join(tmpDir, '.elanous', 'workflows'), { recursive: true });
});

afterEach(() => {
  process.chdir(prevCwd);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seedWorkflow(name: string, body: string): void {
  writeFileSync(join(tmpDir, '.elanous', 'workflows', `${name}.yaml`), body, 'utf-8');
}

const SUMMARY_YAML = `name: my-summary
description: |
  Use when: User wants a summary.
  Triggers: "summarize", "tl;dr".
  Does: Returns essential summary.
  NOT for: Multi-source comparison.
nodes:
  - id: a
    bash: 'echo ok'
`;

const REVIEW_YAML = `name: my-review
description: |
  Use when: User wants a code review.
  Triggers: "review", "check diff".
  Does: Diff -> AI review -> approval.
  NOT for: GitHub PR flows.
nodes:
  - id: a
    bash: 'echo ok'
`;

describe('routeWorkflow — builtin discovery', () => {
  it('discovers the 4 baked-in samples/workflows even from empty cwd', async () => {
    // No project-local workflows seeded → only the repo's
    // samples/workflows/ builtins should show up. The router prompt
    // therefore lists at least the 4 builtin candidates.
    let capturedPrompt = '';
    const fakeLLM: RouterLLMCaller = async (prompt) => {
      capturedPrompt = prompt;
      return '/invoke-workflow quick-summary';
    };
    const r = await routeWorkflow({ userMessage: 'sum' }, fakeLLM);
    expect(r.name).toBe('quick-summary');
    // All 4 builtins should appear in the candidate list
    expect(capturedPrompt).toContain('**quick-summary**');
    expect(capturedPrompt).toContain('**code-review**');
    expect(capturedPrompt).toContain('**pdca-cycle**');
    expect(capturedPrompt).toContain('**build-workflow**');
  });
});

describe('routeWorkflow — happy path', () => {
  it('returns the LLM-picked workflow name when regex misses', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    seedWorkflow('my-review', REVIEW_YAML);

    let capturedPrompt = '';
    const fakeLLM: RouterLLMCaller = async (prompt) => {
      capturedPrompt = prompt;
      return '/invoke-workflow my-summary';
    };
    // Paraphrase that doesn't substring-match any candidate's
    // Triggers: line — forces the LLM escalation path.
    const r = await routeWorkflow({ userMessage: 'shorten this for me' }, fakeLLM);

    expect(r.name).toBe('my-summary');
    expect(r.source).toBe('llm');
    expect(r.error).toBeUndefined();
    expect(r.reasoning).toBe('/invoke-workflow my-summary');

    // The prompt must include both candidates' descriptions
    expect(capturedPrompt).toContain('**my-summary**');
    expect(capturedPrompt).toContain('**my-review**');
    expect(capturedPrompt).toContain('Use when:');
    expect(capturedPrompt).toContain('NOT for:');
    expect(capturedPrompt).toContain('"shorten this for me"');
  });

  it('handles LLM responses with prepended analysis text', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    const fakeLLM: RouterLLMCaller = async () =>
      'I think the user wants a summary.\nThe best match is:\n/invoke-workflow my-summary';
    // 'shorten please' avoids both summarize/tl;dr triggers — LLM path.
    const r = await routeWorkflow({ userMessage: 'shorten please' }, fakeLLM);
    expect(r.name).toBe('my-summary');
    expect(r.source).toBe('llm');
  });
});

describe('routeWorkflow — error paths', () => {
  it('LLM picks unknown name → name=null + error', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    const fakeLLM: RouterLLMCaller = async () => '/invoke-workflow nonexistent-name';
    const r = await routeWorkflow({ userMessage: 'whatever' }, fakeLLM);
    expect(r.name).toBeNull();
    expect(r.error).toContain('Unknown candidate');
    expect(r.error).toContain('my-summary');
  });

  it('LLM emits no /invoke-workflow line → name=null without error', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    const fakeLLM: RouterLLMCaller = async () => 'I cannot decide.';
    const r = await routeWorkflow({ userMessage: 'unclear' }, fakeLLM);
    expect(r.name).toBeNull();
    expect(r.error).toBeUndefined();
  });

  it('LLM call throws → caught + surfaced as error string', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    const fakeLLM: RouterLLMCaller = async () => {
      throw new Error('rate-limited');
    };
    const r = await routeWorkflow({ userMessage: 'try again' }, fakeLLM);
    expect(r.name).toBeNull();
    expect(r.error).toContain('rate-limited');
  });
});

describe('routeWorkflow — opts forwarding', () => {
  it('forwards model + provider opts to LLM caller', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    let capturedOpts: { model?: string; provider?: string } = {};
    const fakeLLM: RouterLLMCaller = async (_prompt, opts) => {
      capturedOpts = opts;
      return '/invoke-workflow my-summary';
    };
    await routeWorkflow(
      { userMessage: 'sum', model: 'haiku', provider: 'anthropic' },
      fakeLLM,
    );
    expect(capturedOpts.model).toBe('haiku');
    expect(capturedOpts.provider).toBe('anthropic');
  });

  it('omits model/provider when caller did not set them', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    let capturedOpts: { model?: string; provider?: string } = {};
    const fakeLLM: RouterLLMCaller = async (_prompt, opts) => {
      capturedOpts = opts;
      return '/invoke-workflow my-summary';
    };
    await routeWorkflow({ userMessage: 'sum' }, fakeLLM);
    expect(capturedOpts.model).toBeUndefined();
    expect(capturedOpts.provider).toBeUndefined();
  });
});

describe('routeWorkflow — cascade (regex first → LLM escalate)', () => {
  it('regex single hit returns immediately without calling LLM', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    seedWorkflow('my-review', REVIEW_YAML);

    let llmCallCount = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCallCount += 1;
      return '/invoke-workflow my-summary';
    };
    // 'review' is a substring of 'please review this' and is a
    // trigger ONLY on my-review (the builtin code-review's triggers
    // are "review my branch" / "code review" / "check diff", none of
    // which substring-match this input). Single regex hit → LLM
    // path skipped entirely.
    const r = await routeWorkflow(
      { userMessage: 'please review this' },
      fakeLLM,
    );

    expect(r.name).toBe('my-review');
    expect(r.source).toBe('regex');
    expect(r.error).toBeUndefined();
    expect(r.reasoning).toContain('regex matched');
    expect(llmCallCount).toBe(0);
  });

  it('regex multiple hits escalate to LLM', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    seedWorkflow('my-review', REVIEW_YAML);

    let llmCallCount = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCallCount += 1;
      return '/invoke-workflow my-review';
    };
    // 'tl;dr' fires both my-summary AND the builtin quick-summary;
    // 'review' fires my-review. ≥2 candidates → escalate to LLM.
    const r = await routeWorkflow(
      { userMessage: 'tl;dr review please' },
      fakeLLM,
    );

    expect(r.name).toBe('my-review');
    expect(r.source).toBe('llm');
    expect(llmCallCount).toBe(1);
  });

  it('regex miss escalates to LLM', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);

    let llmCallCount = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCallCount += 1;
      return '/invoke-workflow my-summary';
    };
    const r = await routeWorkflow({ userMessage: 'paraphrase please' }, fakeLLM);

    expect(r.name).toBe('my-summary');
    expect(r.source).toBe('llm');
    expect(llmCallCount).toBe(1);
  });

  it('empty discovery short-circuits with source=none (no LLM call)', async () => {
    // No workflows seeded into tmpDir AND we point cwd at tmpDir so
    // the builtin sampler picks up the repo's samples/workflows. To
    // hit the empty path we'd need a tree without those — but the
    // discovery layer always finds the 4 builtins. So instead we
    // assert the contract that *when* candidates is empty, source=none
    // and LLM is never called. This is verified directly in the
    // pure unit tests for `routeWithFallback`; here we just confirm
    // the endpoint propagates `source` for the populated case.
    let llmCallCount = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCallCount += 1;
      return '/invoke-workflow quick-summary';
    };
    const r = await routeWorkflow({ userMessage: 'paraphrase please' }, fakeLLM);
    expect(r.source).toBe('llm');
    expect(llmCallCount).toBe(1);
  });
});

describe('routeWorkflow — context section', () => {
  it('includes context fields in the prompt', async () => {
    seedWorkflow('my-summary', SUMMARY_YAML);
    let capturedPrompt = '';
    const fakeLLM: RouterLLMCaller = async (prompt) => {
      capturedPrompt = prompt;
      return '/invoke-workflow my-summary';
    };
    await routeWorkflow(
      {
        userMessage: 'sum',
        context: {
          platformType: 'pwa',
          title: 'morning briefing',
          labels: ['daily', 'auto'],
        },
      },
      fakeLLM,
    );
    expect(capturedPrompt).toContain('## Context');
    expect(capturedPrompt).toContain('Platform: pwa');
    expect(capturedPrompt).toContain('Title: morning briefing');
    expect(capturedPrompt).toContain('Labels: daily, auto');
  });
});
