// DS-3a preflight · HitTarget `input` kind extension
// (PLAN-hittarget-input-kind-extension.md §3).
//
// Locks the matcher grammar for the new `{kind:'input', inputId}`
// variant so binding tables can declare rules like
// `click:input.chat-main` without the resolver silently emitting
// `click:unknown`.

import { describe, expect, test } from 'bun:test';
import {
  toMatcher,
  matcherCascade,
  type MouseInputEvent,
  type HitTarget,
} from '../src/input-core/event.js';

function mouse(
  type: MouseInputEvent['type'],
  target: HitTarget,
  modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
): MouseInputEvent {
  return {
    kind: 'mouse',
    type,
    row: 10,
    col: 5,
    target,
    ...(modifiers.shift ? { shift: true } : {}),
    ...(modifiers.ctrl ? { ctrl: true } : {}),
    ...(modifiers.alt ? { alt: true } : {}),
  };
}

describe('toMatcher · input kind', () => {
  test('click on input hit → click:input.chat-main', () => {
    const ev = mouse('click', { kind: 'input', inputId: 'chat-main' });
    expect(toMatcher(ev)).toBe('click:input.chat-main');
  });

  test('drag / release / right-click all produce kind:input.<inputId>', () => {
    const target: HitTarget = { kind: 'input', inputId: 'chat-main' };
    expect(toMatcher(mouse('drag', target))).toBe('drag:input.chat-main');
    expect(toMatcher(mouse('release', target))).toBe('release:input.chat-main');
    expect(toMatcher(mouse('right-click', target))).toBe('right-click:input.chat-main');
  });

  test('modifiers decorate the input matcher as usual', () => {
    const ev = mouse(
      'click',
      { kind: 'input', inputId: 'chat-main' },
      { ctrl: true, shift: true },
    );
    expect(toMatcher(ev)).toBe('ctrl+shift+click:input.chat-main');
  });

  test('custom inputId (non-chat-main) round-trips verbatim', () => {
    const ev = mouse('click', { kind: 'input', inputId: 'search-bar' });
    expect(toMatcher(ev)).toBe('click:input.search-bar');
  });
});

describe('matcherCascade · input kind', () => {
  test('cascades from kind.detail down to kind', () => {
    const ev = mouse('click', { kind: 'input', inputId: 'chat-main' });
    expect(matcherCascade(ev)).toEqual(['click:input.chat-main', 'click:input']);
  });

  test('generic `click:input` rule matches any inputId', () => {
    // Documentation test — the resolver picks the first binding
    // present in the table; callers declaring `click:input` (no
    // detail) catch every text-input widget regardless of its id.
    const a = matcherCascade(mouse('click', { kind: 'input', inputId: 'chat-main' }));
    const b = matcherCascade(mouse('click', { kind: 'input', inputId: 'search-bar' }));
    expect(a[1]).toBe('click:input');
    expect(b[1]).toBe('click:input');
  });
});
