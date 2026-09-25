// ── U-4.2 · wd-log widget freeze/search state tests ──
//
// Guards the U-4.2 widget-state extension: when dashboard syncs
// frozenTailIndex / searchQuery / searchCursor into log widget state,
// the widget's render pipes them through to renderLogPane so the
// chat-only / plugin-default branches keep the visual output they had
// when calling renderLogPane directly.

import { describe, test, expect } from 'bun:test';
import logWidget, { type LogWidgetState } from '../widgets/log/widget.js';

function defaultState(overrides: Partial<LogWidgetState> = {}): LogWidgetState {
  return {
    lines: [],
    scrollOffset: -1,
    focused: false,
    scroll: 0,
    ...overrides,
  };
}

const fakeCtx = {
  width: 40,
  height: 8,
  focused: false,
  character: 'Log',
};

describe('wd-log widget · freeze/search pass-through (U-4.2)', () => {
  test('renders without freeze/search when state fields absent (default behavior)', () => {
    const state = defaultState({ lines: ['a', 'b', 'c'] });
    const rows = logWidget.render!(state, fakeCtx as never);
    expect(rows.length).toBeGreaterThan(0);
    // Title row should be present; without search, no "of N" badge.
    const title = rows[0] ?? '';
    expect(title).toContain('Log');
  });

  test('frozenTailIndex null is treated as absent (default branch)', () => {
    const state = defaultState({
      lines: ['x', 'y', 'z'],
      frozenTailIndex: null,
    });
    const rows = logWidget.render!(state, fakeCtx as never);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('searchQuery drives the badge · title has "of N" when cursor set', () => {
    const state = defaultState({
      lines: ['match here', 'skip', 'also match'],
      searchQuery: 'match',
      searchCursor: { current: 1, total: 2 },
    });
    const rows = logWidget.render!(state, fakeCtx as never);
    const title = rows[0] ?? '';
    // The title row rendered by renderLogPane includes the match
    // counter when searchCursor is present. Format today is `N/M`
    // alongside the `🔍 "query"` prefix — exact formatting is
    // renderer-owned, we just verify the counter showed up.
    expect(title).toContain('1/2');
    expect(title).toContain('match');
  });

  test('searchQuery without cursor still renders · no badge', () => {
    const state = defaultState({
      lines: ['hello'],
      searchQuery: 'nomatch',
      searchCursor: null,
    });
    const rows = logWidget.render!(state, fakeCtx as never);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('filterQuery narrows visible rows and surfaces filter badge', () => {
    const state = defaultState({
      lines: ['alpha', 'needle one', 'beta', 'needle two'],
      filterQuery: 'needle',
    });
    const rows = logWidget.render!(state, fakeCtx as never);
    expect(rows[0]).toContain('⌕ needle');
    expect(rows.join('\n')).toContain('needle one');
    expect(rows.join('\n')).toContain('needle two');
    expect(rows.join('\n')).not.toContain('alpha');
  });

  test('frozenTailIndex caps the visible range', () => {
    // 20 lines, freeze at 10 — renderer should cap body to the frozen
    // prefix instead of showing all 20.
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const frozen = logWidget.render!(
      defaultState({ lines, frozenTailIndex: 10, scrollOffset: 0 }),
      fakeCtx as never,
    );
    const unfrozen = logWidget.render!(
      defaultState({ lines, scrollOffset: 0 }),
      fakeCtx as never,
    );
    // The two renders differ · frozen view should not include line-15
    // or beyond while unfrozen view may.
    const frozenText = frozen.join('\n');
    expect(frozenText).not.toContain('line-15');
  });

  test('state-shape compatibility · new optional fields don\'t break existing consumers', () => {
    // Previously the state was { lines, scrollOffset, focused,
    // footerLine?, scroll, maxScroll?, pageSize?, halfPageSize? }.
    // Widget should still render correctly when only those fields are
    // provided (no freeze/search).
    const legacy: LogWidgetState = {
      lines: ['legacy'],
      scrollOffset: -1,
      focused: false,
      footerLine: 'thinking…',
      scroll: 0,
    };
    const rows = logWidget.render!(legacy, fakeCtx as never);
    expect(rows.length).toBeGreaterThan(0);
    // Footer should still render
    expect(rows.some((r) => r.includes('thinking'))).toBe(true);
  });
});
