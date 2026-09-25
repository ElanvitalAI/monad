// HANDOFF §4.2 follow-up — verify the skill router endpoint mirrors
// the workflow router endpoint's contract: regex first → LLM escalate,
// `source` field surfaced for cost telemetry, error paths consistent.

import { describe, expect, it } from 'bun:test';
import { routeSkill, type RouterLLMCaller } from '../src/nexus/api/skill-router.js';
import type { SkillIndexEntry } from '../src/skills/index.js';

/** Build a minimal SkillIndexEntry for tests. We only populate the
 *  fields the router cares about — the rest get sensible defaults so
 *  consumers that read the index don't crash. */
function entry(name: string, description: string, triggers: string[]): SkillIndexEntry {
  return {
    name,
    description,
    triggers,
    extractedTriggers: [],
    triggerSource: triggers.length > 0 ? 'explicit' : 'none',
    autoTrigger: false,
    composes: [],
    skillDir: `/tmp/${name}`,
    rootDir: '/tmp',
  };
}

const DIGEST = entry(
  'omni-digest',
  'Use when: User wants a summary.\nDoes: Returns a digest.',
  ['summarize', 'tl;dr', '요약'],
);

const CRAWL = entry(
  'omni-crawl',
  'Use when: User wants to search the web.\nDoes: Crawls.',
  ['search', 'crawl', '검색'],
);

describe('routeSkill — cascade (regex first → LLM escalate)', () => {
  it('regex single hit returns immediately without calling LLM', async () => {
    let llmCalls = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCalls += 1;
      return '/invoke-skill omni-crawl';
    };
    const r = await routeSkill(
      { userMessage: 'please summarize' },
      fakeLLM,
      () => [DIGEST, CRAWL],
    );

    expect(r.name).toBe('omni-digest');
    expect(r.source).toBe('regex');
    expect(r.error).toBeUndefined();
    expect(r.reasoning).toContain('regex matched');
    expect(llmCalls).toBe(0);
  });

  it('regex miss escalates to LLM (source=llm)', async () => {
    let llmCalls = 0;
    let capturedPrompt = '';
    const fakeLLM: RouterLLMCaller = async (prompt) => {
      llmCalls += 1;
      capturedPrompt = prompt;
      return '/invoke-skill omni-digest';
    };
    const r = await routeSkill(
      { userMessage: 'paraphrase this for me' },
      fakeLLM,
      () => [DIGEST, CRAWL],
    );

    expect(r.name).toBe('omni-digest');
    expect(r.source).toBe('llm');
    expect(llmCalls).toBe(1);
    // Skill router uses /invoke-skill (not /invoke-workflow).
    expect(capturedPrompt).toContain('/invoke-skill <candidate-name>');
    expect(capturedPrompt).toContain('**omni-digest**');
    expect(capturedPrompt).toContain('**omni-crawl**');
  });

  it('regex multiple hits escalate to LLM', async () => {
    let llmCalls = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCalls += 1;
      return '/invoke-skill omni-crawl';
    };
    // 'summarize' matches DIGEST; 'crawl' matches CRAWL → 2 hits.
    const r = await routeSkill(
      { userMessage: 'summarize after crawl' },
      fakeLLM,
      () => [DIGEST, CRAWL],
    );

    expect(r.name).toBe('omni-crawl');
    expect(r.source).toBe('llm');
    expect(llmCalls).toBe(1);
  });

  it('empty skill index returns source=none + error without calling LLM', async () => {
    let llmCalls = 0;
    const fakeLLM: RouterLLMCaller = async () => {
      llmCalls += 1;
      return '/invoke-skill x';
    };
    const r = await routeSkill(
      { userMessage: 'anything' },
      fakeLLM,
      () => [],
    );

    expect(r.name).toBeNull();
    expect(r.source).toBe('none');
    expect(r.error).toBe('no skills discovered');
    expect(llmCalls).toBe(0);
  });
});

describe('routeSkill — error paths', () => {
  it('LLM picks unknown name → name=null + error', async () => {
    const fakeLLM: RouterLLMCaller = async () => '/invoke-skill nonexistent';
    const r = await routeSkill(
      { userMessage: 'paraphrase' },
      fakeLLM,
      () => [DIGEST],
    );
    expect(r.name).toBeNull();
    expect(r.source).toBe('llm');
    expect(r.error).toContain('Unknown candidate');
    expect(r.error).toContain('omni-digest');
  });

  it('LLM emits no /invoke-skill line → name=null without error', async () => {
    const fakeLLM: RouterLLMCaller = async () => 'I cannot decide.';
    const r = await routeSkill(
      { userMessage: 'paraphrase' },
      fakeLLM,
      () => [DIGEST],
    );
    expect(r.name).toBeNull();
    expect(r.source).toBe('llm');
    expect(r.error).toBeUndefined();
  });

  it('LLM call throws → caught + surfaced as error string', async () => {
    const fakeLLM: RouterLLMCaller = async () => {
      throw new Error('rate-limited');
    };
    const r = await routeSkill(
      { userMessage: 'paraphrase' },
      fakeLLM,
      () => [DIGEST],
    );
    expect(r.name).toBeNull();
    expect(r.source).toBe('llm');
    expect(r.error).toContain('rate-limited');
  });
});

describe('routeSkill — opts forwarding', () => {
  it('forwards model + provider to LLM caller', async () => {
    let captured: { model?: string; provider?: string } = {};
    const fakeLLM: RouterLLMCaller = async (_prompt, opts) => {
      captured = opts;
      return '/invoke-skill omni-digest';
    };
    await routeSkill(
      { userMessage: 'paraphrase', model: 'haiku', provider: 'anthropic' },
      fakeLLM,
      () => [DIGEST],
    );
    expect(captured.model).toBe('haiku');
    expect(captured.provider).toBe('anthropic');
  });

  it('omits model/provider when caller did not set them', async () => {
    let captured: { model?: string; provider?: string } = {};
    const fakeLLM: RouterLLMCaller = async (_prompt, opts) => {
      captured = opts;
      return '/invoke-skill omni-digest';
    };
    await routeSkill(
      { userMessage: 'paraphrase' },
      fakeLLM,
      () => [DIGEST],
    );
    expect(captured.model).toBeUndefined();
    expect(captured.provider).toBeUndefined();
  });
});

describe('routeSkill — context', () => {
  it('passes context fields into the LLM prompt', async () => {
    let capturedPrompt = '';
    const fakeLLM: RouterLLMCaller = async (prompt) => {
      capturedPrompt = prompt;
      return '/invoke-skill omni-digest';
    };
    await routeSkill(
      {
        userMessage: 'paraphrase',
        context: { platformType: 'pwa', title: 'morning briefing' },
      },
      fakeLLM,
      () => [DIGEST],
    );
    expect(capturedPrompt).toContain('## Context');
    expect(capturedPrompt).toContain('Platform: pwa');
    expect(capturedPrompt).toContain('Title: morning briefing');
  });
});

describe('routeSkill — uses entry.triggers (NOT description parsing)', () => {
  it('matches a skill whose description has no Triggers: line, via frontmatter triggers', async () => {
    // Skill with prose-only description but explicit triggers in
    // frontmatter (the common case for ~/.claude/skills/* skills).
    // The cascade must use the frontmatter array directly — not try
    // to parse the description.
    const proseOnly = entry(
      'prose-only',
      'A short prose blurb. No 4-line convention here.',
      ['shorten'],
    );
    let llmCalls = 0;
    const r = await routeSkill(
      { userMessage: 'shorten this' },
      async () => { llmCalls += 1; return '/invoke-skill x'; },
      () => [proseOnly],
    );
    expect(r.name).toBe('prose-only');
    expect(r.source).toBe('regex');
    expect(llmCalls).toBe(0);
  });
});
