// Pure unit tests for the regex → LLM cascade in
// `src/skills/llm-router.ts`. The cascade is the cost-ceiling
// chokepoint described in HANDOFF §4.2: regex hit (1 candidate) bypasses
// the LLM call entirely; 0 or ≥2 hits escalate.

import { describe, expect, it } from 'bun:test';
import {
  extractTriggersFromDescription,
  regexMatchCandidates,
  routeWithFallback,
  type RouteCandidate,
} from '../src/skills/llm-router.js';

const SUMMARY: RouteCandidate = {
  name: 'my-summary',
  description: [
    'Use when: User wants a summary.',
    'Triggers: "summarize", "tl;dr", "요약".',
    'Does: Returns essential summary.',
    'NOT for: Multi-source comparison.',
  ].join('\n'),
};

const REVIEW: RouteCandidate = {
  name: 'my-review',
  description: [
    'Use when: User wants a code review.',
    'Triggers: "review", "check diff".',
    'Does: Diff -> AI review -> approval.',
    'NOT for: GitHub PR flows.',
  ].join('\n'),
};

const NO_CONV: RouteCandidate = {
  name: 'no-conv',
  description: 'A workflow that ignores the 4-line convention.',
};

describe('extractTriggersFromDescription', () => {
  it('parses double-quoted phrases on the Triggers line', () => {
    const triggers = extractTriggersFromDescription(SUMMARY.description);
    expect(triggers).toEqual(['summarize', 'tl;dr', '요약']);
  });

  it('parses single-quoted phrases too', () => {
    const desc = "Use when: x.\nTriggers: 'foo', 'bar'.\nDoes: y.\nNOT for: z.";
    expect(extractTriggersFromDescription(desc)).toEqual(['foo', 'bar']);
  });

  it('lowercases trigger phrases', () => {
    const desc = 'Use when: x.\nTriggers: "FooBar", "BAZ".\nDoes: y.\nNOT for: z.';
    expect(extractTriggersFromDescription(desc)).toEqual(['foobar', 'baz']);
  });

  it('returns empty when the convention is not followed', () => {
    expect(extractTriggersFromDescription(NO_CONV.description)).toEqual([]);
  });

  it('returns empty for the empty string', () => {
    expect(extractTriggersFromDescription('')).toEqual([]);
  });

  it('ignores bare words outside quotes (meta-language like "e.g.")', () => {
    const desc = 'Use when: x.\nTriggers: e.g., "actual", "real".\nDoes: y.\nNOT for: z.';
    expect(extractTriggersFromDescription(desc)).toEqual(['actual', 'real']);
  });

  it('handles a Triggers line at end-of-string with no following label', () => {
    const desc = 'Use when: x.\nTriggers: "alpha", "beta".';
    expect(extractTriggersFromDescription(desc)).toEqual(['alpha', 'beta']);
  });
});

describe('regexMatchCandidates', () => {
  it('returns single match when only one candidate has a substring trigger', () => {
    const matched = regexMatchCandidates('please give me the tl;dr', [SUMMARY, REVIEW]);
    expect(matched.map((c) => c.name)).toEqual(['my-summary']);
  });

  it('returns multiple matches when several triggers fire', () => {
    const matched = regexMatchCandidates('tl;dr then review', [SUMMARY, REVIEW]);
    expect(matched.map((c) => c.name).sort()).toEqual(['my-review', 'my-summary']);
  });

  it('returns empty when no triggers match the input', () => {
    expect(regexMatchCandidates('paraphrase please', [SUMMARY, REVIEW])).toEqual([]);
  });

  it('returns empty for an empty user message', () => {
    expect(regexMatchCandidates('   ', [SUMMARY, REVIEW])).toEqual([]);
  });

  it('skips candidates that lack a Triggers line entirely', () => {
    expect(regexMatchCandidates('a workflow', [NO_CONV])).toEqual([]);
  });

  it('is case-insensitive on the user message side', () => {
    const matched = regexMatchCandidates('SUMMARIZE this', [SUMMARY]);
    expect(matched.map((c) => c.name)).toEqual(['my-summary']);
  });

  it('honors a custom extractor when supplied', () => {
    const matched = regexMatchCandidates(
      'a workflow now',
      [NO_CONV],
      () => ['workflow'],
    );
    expect(matched.map((c) => c.name)).toEqual(['no-conv']);
  });

  it('prefers candidate.triggers when set (skips description parsing)', () => {
    // Candidate has a description that doesn't follow the 4-line
    // convention, but the caller provided triggers explicitly —
    // mirrors how the skill router supplies SkillIndexEntry.triggers
    // from YAML frontmatter.
    const skillLike: RouteCandidate = {
      name: 'omni-digest',
      description: 'A free-form prose blurb without any Triggers: line.',
      triggers: ['summarize', 'tl;dr'],
    };
    const matched = regexMatchCandidates('please summarize', [skillLike]);
    expect(matched.map((c) => c.name)).toEqual(['omni-digest']);
  });

  it('lowercases candidate.triggers before matching', () => {
    const skillLike: RouteCandidate = {
      name: 'shouty',
      description: 'whatever',
      triggers: ['SUMMARIZE', 'TL;DR'],
    };
    const matched = regexMatchCandidates('summarize this', [skillLike]);
    expect(matched.map((c) => c.name)).toEqual(['shouty']);
  });

  it('candidate.triggers=[] (empty array) bypasses description parsing AND matches nothing', () => {
    // Author opted out of regex routing for this candidate by
    // providing an empty triggers list. The cascade should NOT fall
    // back to parsing the description — that would override the
    // author's intent.
    const skill: RouteCandidate = {
      name: 'no-auto',
      description: 'Use when: x.\nTriggers: "alpha".\nDoes: y.\nNOT for: z.',
      triggers: [],
    };
    expect(regexMatchCandidates('alpha please', [skill])).toEqual([]);
  });
});

describe('routeWithFallback — cascade', () => {
  it('regex single hit returns source=regex without calling LLM', async () => {
    let llmCalls = 0;
    const result = await routeWithFallback({
      userMessage: 'tl;dr please',
      candidates: [SUMMARY, REVIEW],
      llm: async () => {
        llmCalls += 1;
        return '/invoke-workflow my-review';
      },
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBe('my-summary');
    expect(result.source).toBe('regex');
    expect(result.reasoning).toContain('regex matched');
    expect(result.error).toBeUndefined();
    expect(llmCalls).toBe(0);
  });

  it('regex zero hits escalates to LLM (source=llm)', async () => {
    let llmCalls = 0;
    const result = await routeWithFallback({
      userMessage: 'paraphrase this for me',
      candidates: [SUMMARY, REVIEW],
      llm: async () => {
        llmCalls += 1;
        return '/invoke-workflow my-summary';
      },
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBe('my-summary');
    expect(result.source).toBe('llm');
    expect(llmCalls).toBe(1);
  });

  it('regex multiple hits escalates to LLM (ambiguity → LLM tiebreak)', async () => {
    let llmCalls = 0;
    const result = await routeWithFallback({
      userMessage: 'tl;dr then review',
      candidates: [SUMMARY, REVIEW],
      llm: async () => {
        llmCalls += 1;
        return '/invoke-workflow my-review';
      },
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBe('my-review');
    expect(result.source).toBe('llm');
    expect(llmCalls).toBe(1);
  });

  it('skipRegex=true forces LLM even when regex would have hit', async () => {
    let llmCalls = 0;
    const result = await routeWithFallback({
      userMessage: 'tl;dr please',
      candidates: [SUMMARY, REVIEW],
      llm: async () => {
        llmCalls += 1;
        return '/invoke-workflow my-summary';
      },
      skipRegex: true,
      invokeCommand: '/invoke-workflow',
    });
    expect(result.source).toBe('llm');
    expect(llmCalls).toBe(1);
  });

  it('empty candidates returns source=none without calling LLM', async () => {
    let llmCalls = 0;
    const result = await routeWithFallback({
      userMessage: 'anything',
      candidates: [],
      llm: async () => {
        llmCalls += 1;
        return '/invoke-workflow x';
      },
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBeNull();
    expect(result.source).toBe('none');
    expect(llmCalls).toBe(0);
  });

  it('LLM throws → source=llm + error captured', async () => {
    const result = await routeWithFallback({
      userMessage: 'paraphrase',
      candidates: [SUMMARY],
      llm: async () => {
        throw new Error('rate-limited');
      },
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBeNull();
    expect(result.source).toBe('llm');
    expect(result.error).toBe('rate-limited');
  });

  it('LLM picks unknown name → name=null + error', async () => {
    const result = await routeWithFallback({
      userMessage: 'paraphrase',
      candidates: [SUMMARY],
      llm: async () => '/invoke-workflow nonexistent',
      invokeCommand: '/invoke-workflow',
    });
    expect(result.name).toBeNull();
    expect(result.source).toBe('llm');
    expect(result.error).toContain('Unknown candidate');
  });

  it('forwards llmCallOpts to the LLM caller', async () => {
    let captured: { model?: string; provider?: string } = {};
    await routeWithFallback({
      userMessage: 'paraphrase',
      candidates: [SUMMARY],
      llm: async (_prompt, opts) => {
        captured = opts;
        return '/invoke-workflow my-summary';
      },
      llmCallOpts: { model: 'haiku', provider: 'anthropic' },
      invokeCommand: '/invoke-workflow',
    });
    expect(captured.model).toBe('haiku');
    expect(captured.provider).toBe('anthropic');
  });

  it('uses custom invokeCommand in the prompt + parser', async () => {
    let capturedPrompt = '';
    const result = await routeWithFallback({
      userMessage: 'paraphrase',
      candidates: [SUMMARY],
      llm: async (prompt) => {
        capturedPrompt = prompt;
        return '/invoke-skill my-summary';
      },
      invokeCommand: '/invoke-skill',
    });
    expect(capturedPrompt).toContain('/invoke-skill <candidate-name>');
    expect(result.name).toBe('my-summary');
    expect(result.source).toBe('llm');
  });

  it('passes context through to the prompt builder', async () => {
    let capturedPrompt = '';
    await routeWithFallback({
      userMessage: 'paraphrase',
      candidates: [SUMMARY],
      llm: async (prompt) => {
        capturedPrompt = prompt;
        return '/invoke-workflow my-summary';
      },
      context: { platformType: 'pwa', title: 'morning' },
      invokeCommand: '/invoke-workflow',
    });
    expect(capturedPrompt).toContain('## Context');
    expect(capturedPrompt).toContain('Platform: pwa');
    expect(capturedPrompt).toContain('Title: morning');
  });
});
