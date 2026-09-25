// bell-modal — post-migration test (PR-1 of expression Tier S+A).
//
// Verifies the filter chip bar paints through expression
// `renderStatusModule` (raw SGR) instead of chalk passthroughs.
// Other widget surfaces (event list rows, footer, paneTitle) are
// unchanged and not retested here.

import { describe, expect, test } from 'bun:test';
import bellModalWidget, {
  describeBellModalCursor,
  filterEvents,
  rebuildBellEvents,
  type BellModalState,
  type NotificationFilter,
} from '../src/notifications/bell-modal.js';
import type { NotificationEvent } from '../src/notifications/store.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

interface RenderCtx {
  width: number;
  height: number;
  focused: boolean;
}

function renderWidget(filter: NotificationFilter = 'a', events: NotificationEvent[] = []) {
  const state = bellModalWidget.initialState({ events, filter });
  const ctx: RenderCtx = { width: 80, height: 8, focused: true };
  // The widget contract expects ctx with more fields; cast through unknown.
  return bellModalWidget.render(state, ctx as unknown as Parameters<typeof bellModalWidget.render>[1], 'Notifications');
}

describe('bell-modal · filter chip bar (PR-1 migration)', () => {
  test('chip text content preserved post-migration', () => {
    const lines = renderWidget('a');
    const chipLine = stripAnsi(lines[1] ?? '');
    expect(chipLine).toContain('[u] Unread');
    expect(chipLine).toContain('[e] Errors');
    expect(chipLine).toContain('[a] All');
  });

  test('chip line emits raw SGR (chalk-environment-deterministic)', () => {
    const lines = renderWidget('a');
    expect(lines[1]).toContain('\x1b[38;2;');
  });

  test('active chip uses accent (mauve #cba6f7) — filter=a', () => {
    const lines = renderWidget('a');
    // mauve = #cba6f7 → 203,166,247
    expect(lines[1]).toContain('\x1b[38;2;203;166;247m');
  });

  test('active chip uses accent — filter=u', () => {
    const lines = renderWidget('u');
    expect(lines[1]).toContain('\x1b[38;2;203;166;247m');
  });

  test('inactive chips use muted (#7f849c) — 127,132,156', () => {
    const lines = renderWidget('a');
    // At least 2 muted-painted chips when filter=a (u + e are inactive).
    expect(lines[1]).toContain('\x1b[38;2;127;132;156m');
  });

  test('switching filter shifts which chip is accent-painted', () => {
    const a = renderWidget('a');
    const u = renderWidget('u');
    const e = renderWidget('e');
    // All differ — different chip is accented in each.
    expect(a[1]).not.toBe(u[1]);
    expect(u[1]).not.toBe(e[1]);
    expect(a[1]).not.toBe(e[1]);
  });
});

describe('bell-modal · filter helpers (no migration changes here)', () => {
  const events: NotificationEvent[] = [
    {
      id: '1',
      sessionId: 'term:1',
      ts: 1700000000000,
      kind: 'status',
      title: 't1',
      body: '',
      read: true,
    },
    {
      id: '2',
      sessionId: 'term:1',
      ts: 1700000001000,
      kind: 'error',
      title: 't2',
      body: '',
      read: false,
    },
    {
      id: '3',
      sessionId: 'term:2',
      ts: 1700000002000,
      kind: 'block',
      title: 't3',
      body: '',
      read: false,
    },
  ];

  test('filter=a returns all events', () => {
    expect(filterEvents(events, 'a').length).toBe(3);
  });

  test('filter=u keeps only unread', () => {
    const out = filterEvents(events, 'u');
    expect(out.length).toBe(2);
    expect(out.every((e) => !e.read)).toBe(true);
  });

  test('filter=e keeps only errors', () => {
    const out = filterEvents(events, 'e');
    expect(out.length).toBe(1);
    expect(out[0]!.kind).toBe('error');
  });
});

describe('bell-modal · widget contract', () => {
  test('renders empty-state message when filter has no matches', () => {
    const lines = renderWidget('u', []);
    const stripped = lines.map(stripAnsi).join('\n');
    expect(stripped).toContain('No unread notifications');
  });

  test('renders without throwing for too-small ctx', () => {
    const state = bellModalWidget.initialState({});
    const ctx = { width: 4, height: 2, focused: false } as unknown as Parameters<typeof bellModalWidget.render>[1];
    const out = bellModalWidget.render(state, ctx, 'Notifications');
    // Below the 8x3 minimum → returns empty list.
    expect(out).toEqual([]);
  });

  test('rebuildBellEvents wraps store.list() through filterEvents', () => {
    const sample: NotificationEvent[] = [
      {
        id: '1', sessionId: 'a', ts: 1, kind: 'error',
        title: '', body: '', read: false,
      },
      {
        id: '2', sessionId: 'a', ts: 2, kind: 'status',
        title: '', body: '', read: false,
      },
    ];
    const store = { list: () => sample } as unknown as Parameters<typeof rebuildBellEvents>[0];
    expect(rebuildBellEvents(store, 'e').length).toBe(1);
    expect(rebuildBellEvents(store, 'a').length).toBe(2);
  });
});

// ── Pick A PR-S5: cursor SR utterance ────────────────────────────────

describe('bell-modal · describeBellModalCursor (PR-S5)', () => {
  const sample: NotificationEvent[] = [
    {
      id: '1', sessionId: 'term:1',
      ts: new Date('2026-04-28T09:00:00').getTime(),
      kind: 'status', title: 'working', read: false,
    },
    {
      id: '2', sessionId: 'term:2',
      ts: new Date('2026-04-28T09:00:01').getTime(),
      kind: 'error', title: 'parse error', body: 'unexpected EOF', read: false,
    },
    {
      id: '3', sessionId: 'term:1',
      ts: new Date('2026-04-28T09:00:02').getTime(),
      kind: 'hitl', title: 'awaiting approval', read: true,
    },
  ];

  function stateWith(events: NotificationEvent[], cursor: number): BellModalState {
    return { events, cursor, offset: 0, filter: 'a' };
  }

  test('null when state has no events', () => {
    expect(describeBellModalCursor(stateWith([], 0))).toBeNull();
  });

  test('describes the cursor row (en)', () => {
    const out = describeBellModalCursor(stateWith(sample, 1), { locale: 'en' });
    expect(out).not.toBeNull();
    expect(out!).toContain('term:2');
    expect(out!).toContain('error');
    expect(out!).toContain('parse error');
    expect(out!).toContain('unexpected EOF');
  });

  test('localizes kind word (ko)', () => {
    const out = describeBellModalCursor(stateWith(sample, 1), { locale: 'ko' });
    expect(out!).toContain('오류');
  });

  test('warning level for hitl row', () => {
    const out = describeBellModalCursor(stateWith(sample, 2), { locale: 'en' });
    expect(out!).toContain('warning');
  });

  test('clamps out-of-range cursor to last event', () => {
    // sample[2] = hitl row → localized as 'warning' (en)
    const out = describeBellModalCursor(stateWith(sample, 99), { locale: 'en' });
    expect(out!).toContain('term:1');
    expect(out!).toContain('warning');
    // raw kind 'hitl' is replaced by localized label by default
    expect(out!).not.toContain('hitl');
  });

  test('zero-ANSI utterance (forwarded a11y contract)', () => {
    const out = describeBellModalCursor(stateWith(sample, 0), { locale: 'en' });
    expect(out!).not.toContain('\x1b[');
  });
});
