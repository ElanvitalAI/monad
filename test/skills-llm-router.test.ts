// BACKLOG #7 — verify the LLM router builds correct prompts +
// parses LLM responses into route invocations.

import { describe, expect, it } from 'bun:test';
import {
  buildRouterPrompt,
  parseRouterResponse,
  buildSkillRouterPrompt,
  parseSkillRouterResponse,
  buildWorkflowRouterPrompt,
  parseWorkflowRouterResponse,
  type RouteCandidate,
} from '../src/skills/llm-router.js';

const SAMPLE_CANDIDATES: RouteCandidate[] = [
  {
    name: 'quick-summary',
    description: `Use when: User wants a quick summary of a URL, file path, or YouTube link.
Triggers: "summarize", "요약", "tl;dr", "what is this".
Does: Hands the URL/file off to the omni-digest skill.
NOT for: Multi-source comparison, deep research, rich-format reports.`,
  },
  {
    name: 'code-review',
    description: `Use when: User wants a self-contained code review of the current branch's diff.
Triggers: "review my branch", "code review", "check diff".
Does: gathers diff -> AI review -> user approval -> (optional) post.
NOT for: PR-on-GitHub flows.`,
  },
  {
    name: 'pdca-cycle',
    description: `Use when: User wants to run a PDCA improvement cycle.
Triggers: "pdca", "improvement cycle", "iterate on".
Does: 4-step PDCA via the CFT pdca method.
NOT for: Open-ended exploration.`,
  },
];

// ── buildRouterPrompt ──────────────────────────────────────────────

describe('buildRouterPrompt — empty candidates', () => {
  it('returns the bare userMessage when no candidates supplied', () => {
    expect(buildRouterPrompt('hello', [])).toBe('hello');
  });
});

describe('buildRouterPrompt — basic shape', () => {
  it('embeds every candidate name + description', () => {
    const prompt = buildRouterPrompt('summarize this URL', SAMPLE_CANDIDATES);
    for (const c of SAMPLE_CANDIDATES) {
      expect(prompt).toContain(`**${c.name}**`);
      expect(prompt).toContain('Use when:');
      expect(prompt).toContain('NOT for:');
    }
  });

  it('embeds the user message verbatim (quoted)', () => {
    const prompt = buildRouterPrompt('summarize https://example.com', SAMPLE_CANDIDATES);
    expect(prompt).toContain('"summarize https://example.com"');
  });

  it('includes routing rules + response-format section', () => {
    const prompt = buildRouterPrompt('hello', SAMPLE_CANDIDATES);
    expect(prompt).toContain('## Rules');
    expect(prompt).toContain('## Response format');
  });

  it('default invokeCommand is /invoke', () => {
    const prompt = buildRouterPrompt('hello', SAMPLE_CANDIDATES);
    expect(prompt).toContain('/invoke <candidate-name>');
  });

  it('respects a custom invokeCommand', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES, undefined, {
      invokeCommand: '/invoke-skill',
    });
    expect(prompt).toContain('/invoke-skill <candidate-name>');
  });
});

describe('buildRouterPrompt — context section', () => {
  it('omits context block when context is undefined', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES);
    expect(prompt).not.toContain('## Context');
  });

  it('includes platformType + title when set', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES, {
      platformType: 'pwa',
      title: 'morning briefing',
    });
    expect(prompt).toContain('## Context');
    expect(prompt).toContain('Platform: pwa');
    expect(prompt).toContain('Title: morning briefing');
  });

  it('joins labels with comma', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES, {
      labels: ['urgent', 'review'],
    });
    expect(prompt).toContain('Labels: urgent, review');
  });

  it('threadHistory rendered with newline prefix', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES, {
      threadHistory: 'user: hello\nassistant: hi',
    });
    expect(prompt).toContain('Thread history:');
    expect(prompt).toContain('user: hello');
  });
});

describe('buildRouterPrompt — fallback hint', () => {
  it('appends fallback hint to rules when fallbackName set', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES, undefined, {
      fallbackName: 'assist',
    });
    expect(prompt).toContain('fall back to `assist`');
  });

  it('omits fallback hint when not set', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES);
    expect(prompt).not.toContain('fall back to');
  });
});

// ── parseRouterResponse ────────────────────────────────────────────

describe('parseRouterResponse — happy path', () => {
  it('extracts an exact-match name', () => {
    const r = parseRouterResponse('/invoke quick-summary', SAMPLE_CANDIDATES);
    expect(r.name).toBe('quick-summary');
    expect(r.error).toBeUndefined();
  });

  it('strips the slash command from the trailing remaining message', () => {
    const r = parseRouterResponse('/invoke quick-summary anything else after', SAMPLE_CANDIDATES);
    expect(r.name).toBe('quick-summary');
    expect(r.remainingMessage).toBe('anything else after');
  });

  it('handles multi-line responses (LLM prepended analysis)', () => {
    const r = parseRouterResponse(
      'Some thinking\nthe best match is\n/invoke code-review',
      SAMPLE_CANDIDATES,
    );
    expect(r.name).toBe('code-review');
  });
});

describe('parseRouterResponse — case-insensitive', () => {
  it('matches when LLM upcases the name', () => {
    const r = parseRouterResponse('/invoke QUICK-SUMMARY', SAMPLE_CANDIDATES);
    expect(r.name).toBe('quick-summary');
  });

  it('matches mixed-case', () => {
    const r = parseRouterResponse('/invoke Code-Review', SAMPLE_CANDIDATES);
    expect(r.name).toBe('code-review');
  });
});

describe('parseRouterResponse — error / no-match', () => {
  it('returns name=null + error when name unknown', () => {
    const r = parseRouterResponse('/invoke not-a-skill', SAMPLE_CANDIDATES);
    expect(r.name).toBeNull();
    expect(r.error).toContain('Unknown candidate');
    expect(r.error).toContain('quick-summary');
  });

  it('returns name=null without error when no /invoke command', () => {
    const r = parseRouterResponse('I think you should use quick-summary', SAMPLE_CANDIDATES);
    expect(r.name).toBeNull();
    expect(r.error).toBeUndefined();
  });
});

describe('parseRouterResponse — custom invokeCommand', () => {
  it('matches /invoke-skill when configured', () => {
    const r = parseRouterResponse('/invoke-skill quick-summary', SAMPLE_CANDIDATES, {
      invokeCommand: '/invoke-skill',
    });
    expect(r.name).toBe('quick-summary');
  });

  it('does NOT match /invoke when configured for /invoke-skill (no false positive)', () => {
    const r = parseRouterResponse('/invoke quick-summary', SAMPLE_CANDIDATES, {
      invokeCommand: '/invoke-skill',
    });
    expect(r.name).toBeNull();
  });
});

// ── Skill / Workflow convenience adapters ──────────────────────────

describe('buildSkillRouterPrompt + parseSkillRouterResponse', () => {
  it('uses /invoke-skill and parses /invoke-skill <name>', () => {
    const prompt = buildSkillRouterPrompt('summarize', SAMPLE_CANDIDATES);
    expect(prompt).toContain('/invoke-skill <candidate-name>');

    const r = parseSkillRouterResponse('/invoke-skill quick-summary', SAMPLE_CANDIDATES);
    expect(r.name).toBe('quick-summary');
  });

  it('skill router does NOT match /invoke-workflow output (cross-namespace isolation)', () => {
    const r = parseSkillRouterResponse('/invoke-workflow code-review', SAMPLE_CANDIDATES);
    expect(r.name).toBeNull();
  });
});

describe('buildWorkflowRouterPrompt + parseWorkflowRouterResponse', () => {
  it('uses /invoke-workflow and parses /invoke-workflow <name>', () => {
    const prompt = buildWorkflowRouterPrompt('review my branch', SAMPLE_CANDIDATES);
    expect(prompt).toContain('/invoke-workflow <candidate-name>');

    const r = parseWorkflowRouterResponse('/invoke-workflow code-review', SAMPLE_CANDIDATES);
    expect(r.name).toBe('code-review');
  });

  it('workflow router does NOT match /invoke-skill output (cross-namespace)', () => {
    const r = parseWorkflowRouterResponse('/invoke-skill quick-summary', SAMPLE_CANDIDATES);
    expect(r.name).toBeNull();
  });
});

// ── Description-as-prompt fidelity ──────────────────────────────────

describe('multi-line descriptions are indented inside the prompt', () => {
  it('preserves multi-line description with 2-space indent on continuation', () => {
    const prompt = buildRouterPrompt('hi', SAMPLE_CANDIDATES);
    // The description's "Triggers:" line should appear indented under the
    // candidate header (2-space indent).
    const idx = prompt.indexOf('**quick-summary**');
    expect(idx).toBeGreaterThan(-1);
    const slice = prompt.slice(idx, idx + 300);
    expect(slice).toContain('  Use when:');
    expect(slice).toContain('  Triggers:');
  });
});
