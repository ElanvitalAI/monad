import { describe, expect, test } from 'bun:test';

import { WidgetHost } from '../src/widgets/host.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import sessionsSidebar, {
  type SessionsSidebarState,
  layoutToolbelt,
  renderToolbeltLine,
  shouldShowToolbelt,
} from '../src/session/sidebar-widget.js';
import { stripAnsi } from '../src/tui.js';
import type { SessionCard } from '../src/session/card.js';

function makeHost(): WidgetHost {
  return new WidgetHost({ log: () => {}, requestRender: () => {} });
}

const RENDER_CTX = {
  width: 30,
  height: 6,
  focused: true,
  theme: DEFAULT_THEME_TOKENS,
};

const cards: SessionCard[] = [
  { id: 'term:1', source: 'pty', title: 'claude',  agentKind: 'claude-code', status: 'working',  isAlive: true },
  { id: 'term:2', source: 'pty', title: 'codex',   agentKind: 'codex',       status: 'awaiting', isAlive: true },
  { id: 'term:3', source: 'pty', title: 'gone',    agentKind: 'shell',       status: 'idle',     isAlive: false },
];

describe('sessions-sidebar widget', () => {
  test('ST3 — discover-less register + render shows title + rows', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = {
      cards,
      cursor: 0,
      offset: 0,
    } as SessionsSidebarState;

    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, RENDER_CTX, 'Sessions');
    // title + N rows
    expect(lines.length).toBe(RENDER_CTX.height);
    // All three cards should appear in body lines
    const body = lines.slice(1).join(' ');
    expect(body).toContain('claude');
    expect(body).toContain('codex');
    expect(body).toContain('gone');
  });

  test('ST3 — empty state shows help text, not an error', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, RENDER_CTX, 'Sessions');
    expect(lines.length).toBe(RENDER_CTX.height);
    const joined = lines.join(' ');
    expect(joined).toContain('No sessions');
  });

  test('ST3 — onKey j/k moves cursor, wraps at boundaries', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 0, offset: 0 } as SessionsSidebarState;

    const def = host.defFor('wd-sidebar')!;
    const ctx = host.buildContext<SessionsSidebarState>('wd-sidebar')!;
    def.onKey!({ name: 'j' } as any, inst.state as SessionsSidebarState, ctx);
    expect((inst.state as SessionsSidebarState).cursor).toBe(1);
    def.onKey!({ name: 'j' } as any, inst.state as SessionsSidebarState, ctx);
    expect((inst.state as SessionsSidebarState).cursor).toBe(2);
    // Already at end — j does not overshoot
    def.onKey!({ name: 'j' } as any, inst.state as SessionsSidebarState, ctx);
    expect((inst.state as SessionsSidebarState).cursor).toBe(2);
    def.onKey!({ name: 'k' } as any, inst.state as SessionsSidebarState, ctx);
    expect((inst.state as SessionsSidebarState).cursor).toBe(1);
  });

  test('ST3 — click on a row only selects it', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 0, offset: 0 } as SessionsSidebarState;

    const def = host.defFor('wd-sidebar')!;
    const ctx = host.buildContext<SessionsSidebarState>('wd-sidebar')!;
    // row=1 (body row 0 after the title) — first card
    const actFirst = def.onMouse!({ type: 'click', row: 1, col: 0 }, inst.state as SessionsSidebarState, ctx);
    expect(actFirst).toEqual({ type: 'refresh' });
    expect((inst.state as SessionsSidebarState).cursor).toBe(0);

    // row=2 (second card). Cursor updates.
    const actSecond = def.onMouse!({ type: 'click', row: 2, col: 0 }, inst.state as SessionsSidebarState, ctx);
    expect(actSecond).toEqual({ type: 'refresh' });
    expect((inst.state as SessionsSidebarState).cursor).toBe(1);
  });

  test('ST3 — double-click on a row emits submit session:<id>', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 0, offset: 0 } as SessionsSidebarState;

    const def = host.defFor('wd-sidebar')!;
    const ctx = host.buildContext<SessionsSidebarState>('wd-sidebar')!;
    const act = def.onMouse!({ type: 'double-click', row: 2, col: 0 }, inst.state as SessionsSidebarState, ctx);
    expect(act).toEqual({ type: 'submit', text: 'session:term:2' });
    expect((inst.state as SessionsSidebarState).cursor).toBe(1);
  });

  test('ST3 — enter key on cursor emits submit', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 1, offset: 0 } as SessionsSidebarState;

    const def = host.defFor('wd-sidebar')!;
    const ctx = host.buildContext<SessionsSidebarState>('wd-sidebar')!;
    const act = def.onKey!({ name: 'enter' } as any, inst.state as SessionsSidebarState, ctx);
    expect(act).toEqual({ type: 'submit', text: 'session:term:2' });
  });

  // ── UB — toolbelt ─────────────────────────────────────────────

  test('UB1 — layoutToolbelt emits [Attach][Review][Status] with non-overlapping columns', () => {
    const specs = layoutToolbelt(80);
    expect(specs.map(s => s.id)).toEqual(['attach', 'review', 'status']);
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i]!.startCol).toBeGreaterThan(specs[i - 1]!.endCol);
    }
    // render line width matches request
    const line = renderToolbeltLine(80, new Set(['attach', 'review']));
    expect(stripAnsi(line).length).toBe(80);
    expect(stripAnsi(line)).toContain('[Attach]');
    expect(stripAnsi(line)).toContain('[Status]');
  });

  test('UB2 — shouldShowToolbelt flips on for claude/codex/gemini-cli/aider but not shell', () => {
    expect(shouldShowToolbelt(cards[0])).toBe(true);  // claude-code
    expect(shouldShowToolbelt(cards[1])).toBe(true);  // codex
    expect(shouldShowToolbelt(cards[2])).toBe(false); // shell
    expect(shouldShowToolbelt(undefined)).toBe(false);
  });

  test('UB2 — toolbelt row is reserved when selected card is an agent', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 0, offset: 0 } as SessionsSidebarState;
    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, { ...RENDER_CTX, width: 40, height: 8 }, 'Sessions');
    const last = stripAnsi(lines[lines.length - 1]!);
    expect(last).toContain('[Attach]');
    expect(last).toContain('[Status]');
  });

  test('UB2 — toolbelt NOT reserved when selected card is plain shell', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 2, offset: 0 } as SessionsSidebarState;
    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, { ...RENDER_CTX, width: 40, height: 8 }, 'Sessions');
    const last = stripAnsi(lines[lines.length - 1]!);
    expect(last).not.toContain('[Attach]');
  });

  test('UB1 — click on toolbelt button emits submit toolbelt:<action>:<sessionId>', () => {
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards, cursor: 0, offset: 0 } as SessionsSidebarState;
    const def = host.defFor('wd-sidebar')!;
    const ctx = host.buildContext<SessionsSidebarState>('wd-sidebar')!;

    // Row past the end of cards array — interpreted as toolbelt.
    const specs = layoutToolbelt(200);
    const statusBtn = specs.find(s => s.id === 'status')!;
    const click = def.onMouse!(
      { type: 'click', row: 10, col: statusBtn.startCol + 1 },
      inst.state as SessionsSidebarState,
      ctx,
    );
    expect(click).toEqual({ type: 'submit', text: 'toolbelt:status:term:1' });
  });

  // ── NT3 — unread badge ────────────────────────────────────────

  test('NT3 — row renders unread badge (N) when unreadCount > 0', () => {
    const withUnread: SessionCard[] = [
      { ...cards[0]!, unreadCount: 3 },
      { ...cards[1]!, unreadCount: 0 },
    ];
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards: withUnread, cursor: 0, offset: 0 } as SessionsSidebarState;
    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, { ...RENDER_CTX, width: 40, height: 6 }, 'Sessions');
    const joined = stripAnsi(lines.join('\n'));
    expect(joined).toContain('(3)');
    // Second card (index 1, rendered row 2 after the title) has no (N) chip.
    const secondRow = stripAnsi(lines[2] ?? '');
    expect(secondRow).not.toMatch(/\(\d+\)/);
  });

  test('NT3 — unreadCount > 99 collapses to (99+)', () => {
    const withUnread: SessionCard[] = [{ ...cards[0]!, unreadCount: 250 }];
    const host = makeHost();
    host.register(sessionsSidebar, 'builtin', '');
    const inst = host.spawn({ type: 'sessions-sidebar', id: 'wd-sidebar' });
    inst.state = { cards: withUnread, cursor: 0, offset: 0 } as SessionsSidebarState;
    const def = host.defFor('wd-sidebar')!;
    const lines = def.render(inst.state, { ...RENDER_CTX, width: 40, height: 4 }, 'Sessions');
    expect(stripAnsi(lines.join('\n'))).toContain('(99+)');
  });
});
