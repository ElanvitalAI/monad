import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  applyHintFeedback,
  getFeedbackCountForTesting,
  resetFeedbackCounterForTesting,
} from '../src/tool-hints/feedback.js';
import {
  listHints,
  resetScope,
  setConfigPathForTesting,
  _reloadForTesting,
} from '../src/tool-hints/registry.js';

let tmp: string;

beforeEach(() => {
  tmp = joinPath(tmpdir(), `mh-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  setConfigPathForTesting(joinPath(tmp, 'hints.json'));
  process.env.HINTS_PROJECT_CWD = joinPath(tmp, 'fake-project');
  _reloadForTesting();
  resetFeedbackCounterForTesting();
});

afterEach(() => {
  resetScope('all');
  resetScope('global');
  resetFeedbackCounterForTesting();
  setConfigPathForTesting(null);
  delete process.env.HINTS_PROJECT_CWD;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('applyHintFeedback — rules', () => {
  test('web_fetch timeout creates a param-default timeout hint', () => {
    const hints = applyHintFeedback({
      tool: 'WebFetch',
      args: { url: 'https://example.com' },
      outputText: 'Error: request timeout',
      isError: true,
      durationMs: 3000,
    });
    expect(hints.length).toBe(1);
    expect(hints[0].kind).toBe('param-default');
    expect(hints[0].tool).toBe('WebFetch');
    expect(hints[0].payload?.args).toEqual({ timeout_ms: 30_000 });
    expect(hints[0].sourceSignal).toContain('feedback:');
  });

  test('web_search timeout creates a hint too', () => {
    const hints = applyHintFeedback({
      tool: 'WebSearch',
      args: { query: 'x' },
      outputText: 'fetch timeout after 10s',
      isError: true,
      durationMs: 10_000,
    });
    expect(hints.length).toBe(1);
    expect(hints[0].tool).toBe('WebSearch');
  });

  test('transport error (ENOTFOUND) suggests api_call', () => {
    const hints = applyHintFeedback({
      tool: 'WebFetch',
      args: { url: 'https://bad.example' },
      outputText: 'fetch failed: ENOTFOUND bad.example',
      isError: true,
      durationMs: 50,
    });
    expect(hints.some(h => h.tool === 'api_call' && h.kind === 'prefer')).toBe(true);
  });

  test('"tool not available" message creates a disable hint', () => {
    const hints = applyHintFeedback({
      tool: 'dispatcher',
      args: {},
      outputText: `Tool 'some_missing_tool' not available — exposed tools: A, B.`,
      isError: true,
      durationMs: 1,
    });
    expect(hints.length).toBe(1);
    expect(hints[0].kind).toBe('disable');
    expect(hints[0].tool).toBe('some_missing_tool');
    expect(hints[0].scope).toBe('session');
  });

  test('rate-limit message adds avoid hint at session scope', () => {
    const hints = applyHintFeedback({
      tool: 'WebSearch',
      args: { query: 'x' },
      outputText: 'HTTP 429 Too Many Requests',
      isError: false,
      durationMs: 100,
    });
    expect(hints.some(h => h.kind === 'avoid' && h.scope === 'session')).toBe(true);
  });

  test('successful tool result does not create hints', () => {
    const hints = applyHintFeedback({
      tool: 'Read',
      args: { file_path: '/x' },
      outputText: 'normal output body',
      isError: false,
      durationMs: 2,
    });
    expect(hints).toEqual([]);
  });
});

describe('applyHintFeedback — per-turn cap', () => {
  test('stops creating hints after MAX_FEEDBACK_PER_TURN', () => {
    // Different rule keys so we don't hit the de-dup branch.
    applyHintFeedback({ tool: 'WebFetch', args: {}, outputText: 'request timeout', isError: true, durationMs: 0 });
    applyHintFeedback({ tool: 'Foo', args: {}, outputText: "Tool 'x_tool' not available", isError: true, durationMs: 0 });
    applyHintFeedback({ tool: 'WebSearch', args: {}, outputText: 'HTTP 429 rate limit', isError: false, durationMs: 0 });
    expect(getFeedbackCountForTesting()).toBe(3);
    // 4th attempt is a no-op.
    const hints = applyHintFeedback({
      tool: 'WebFetch',
      args: {},
      outputText: 'ENOTFOUND other.example',
      isError: true,
      durationMs: 0,
    });
    expect(hints).toEqual([]);
  });

  test('resetFeedbackCounterForTesting re-arms the cap', () => {
    applyHintFeedback({ tool: 'WebFetch', args: {}, outputText: 'request timeout', isError: true, durationMs: 0 });
    expect(getFeedbackCountForTesting()).toBe(1);
    resetFeedbackCounterForTesting();
    expect(getFeedbackCountForTesting()).toBe(0);
  });
});

describe('applyHintFeedback — de-dup', () => {
  test('same rule twice in a turn only creates one hint', () => {
    const a = applyHintFeedback({ tool: 'WebFetch', args: {}, outputText: 'request timeout', isError: true, durationMs: 0 });
    const b = applyHintFeedback({ tool: 'WebFetch', args: {}, outputText: 'request timeout again', isError: true, durationMs: 0 });
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);  // de-duped
    // Registry shows a single feedback-sourced hint for this rule.
    const fromFeedback = listHints().filter(h => h.sourceSignal?.includes('webfetch_timeout_default'));
    expect(fromFeedback.length).toBe(1);
  });
});
