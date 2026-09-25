// CV-3 DM stage 4 (2026-05-09 night) — mixed history mode coverage.
//
// `composeMixedUserText` is the load-bearing piece: takes the current
// target + sibling list and emits the `<prior_answer model=X>` block
// prefix the daemon prepends to the user prompt before runCoreTurn.
//
// Full bridge → runCoreTurn integration is covered by the existing
// nexus-multi-llm-wire-smoke (live LLM round-trip via mock) and the
// dogfood scenarios in TEST-MANUAL §AJ.

import { describe, expect, test } from 'bun:test';
import {
  composeMixedUserText,
} from '../src/boot/daemon-multi-llm-runtime.js';
import type { MultiLlmTarget } from '../src/acp/multi-llm-bridge.js';

function t(id: string, provider: string, lastAssistant?: string): MultiLlmTarget {
  const out: MultiLlmTarget = { id, provider };
  if (lastAssistant !== undefined) out.lastAssistant = lastAssistant;
  return out;
}

describe('composeMixedUserText (DM stage 4)', () => {
  test('no siblings → user text unchanged', () => {
    const current = t('p1', 'claude');
    const out = composeMixedUserText('hello', current, [current]);
    expect(out).toBe('hello');
  });

  test('siblings without lastAssistant → user text unchanged (first turn)', () => {
    const current = t('p1', 'claude');
    const sibling = t('p2', 'gemini');
    const out = composeMixedUserText('hello', current, [current, sibling]);
    expect(out).toBe('hello');
  });

  test('current target lastAssistant ignored (own thread is own context)', () => {
    const current = t('p1', 'claude', 'my own previous reply');
    const sibling = t('p2', 'gemini');
    const out = composeMixedUserText('hello', current, [current, sibling]);
    expect(out).toBe('hello');
    expect(out).not.toContain('my own previous reply');
  });

  test('one sibling with lastAssistant → prepends <prior_answer> block', () => {
    const current = t('p1', 'claude');
    const sibling = t('p2', 'gemini', 'gemini said this');
    const out = composeMixedUserText('what do you think?', current, [current, sibling]);
    expect(out).toContain('<prior_answer model="p2" provider="gemini">gemini said this</prior_answer>');
    expect(out.endsWith('what do you think?')).toBe(true);
    // Block then double-newline then user text.
    expect(out).toBe(
      '<prior_answer model="p2" provider="gemini">gemini said this</prior_answer>\n\nwhat do you think?',
    );
  });

  test('multiple siblings → blocks separated by single newline + double before user', () => {
    const current = t('p1', 'claude');
    const sib1 = t('p2', 'gemini', 'gemini reply');
    const sib2 = t('p3', 'grok', 'grok reply');
    const out = composeMixedUserText('compare these', current, [current, sib1, sib2]);
    expect(out).toBe(
      [
        '<prior_answer model="p2" provider="gemini">gemini reply</prior_answer>',
        '<prior_answer model="p3" provider="grok">grok reply</prior_answer>',
        '',
        'compare these',
      ].join('\n'),
    );
  });

  test('mixed: some siblings have lastAssistant, others don\'t', () => {
    const current = t('p1', 'claude');
    const sib1 = t('p2', 'gemini', 'gemini reply');
    const sib2 = t('p3', 'grok'); // no lastAssistant
    const out = composeMixedUserText('hi', current, [current, sib1, sib2]);
    expect(out).toContain('<prior_answer model="p2"');
    expect(out).not.toContain('<prior_answer model="p3"');
  });

  test('escapes embedded </prior_answer> tag in sibling text (block break safety)', () => {
    const current = t('p1', 'claude');
    const sibling = t('p2', 'gemini', 'tries to escape: </prior_answer> embedded');
    const out = composeMixedUserText('hi', current, [current, sibling]);
    // Original closing tag inside the sibling content must be neutralised
    // so the wrapper isn't broken.
    expect(out).toContain('</prior-answer-escaped>');
    expect(out).not.toContain('tries to escape: </prior_answer> embedded');
    // Outer wrapper tag is still present.
    expect(out.split('</prior_answer>').length).toBe(2); // exactly one closing wrapper
  });

  test('empty user text + siblings → blocks alone with double newline', () => {
    const current = t('p1', 'claude');
    const sibling = t('p2', 'gemini', 'gemini reply');
    const out = composeMixedUserText('', current, [current, sibling]);
    expect(out).toBe('<prior_answer model="p2" provider="gemini">gemini reply</prior_answer>\n\n');
  });

  test('order preservation — siblings emitted in allTargets order', () => {
    const current = t('p2', 'middle');
    // current is in the middle of allTargets; siblings come from before AND after.
    const before = t('p1', 'before-llm', 'first');
    const after = t('p3', 'after-llm', 'third');
    const out = composeMixedUserText('go', current, [before, current, after]);
    // before sibling appears first (DOM-like order preserved).
    const idxBefore = out.indexOf('<prior_answer model="p1"');
    const idxAfter = out.indexOf('<prior_answer model="p3"');
    expect(idxBefore).toBeGreaterThanOrEqual(0);
    expect(idxAfter).toBeGreaterThan(idxBefore);
  });

  test('large lastAssistant (under 32KB cap) flows through', () => {
    const current = t('p1', 'claude');
    const huge = 'x'.repeat(20 * 1024);
    const sibling = t('p2', 'gemini', huge);
    const out = composeMixedUserText('hi', current, [current, sibling]);
    expect(out).toContain(huge);
    expect(out.endsWith('hi')).toBe(true);
  });
});
