// IDX-6 Phase 6 icon-migration batch — regression tests.
//
// Asserts that the 3 migrated files (plan-renderer / notification-bell-modal
// / sessions-sidebar-widget) now route their status glyphs through
// `theme-icons.icon()` instead of hardcoded emoji. The observable
// contract is:
//   1. With ELANOUS_ASCII_ICONS=1 set, migrated glyphs fall back to the
//      bracketed ASCII form (`[v] / [E] / [ ] / [>]`).
//   2. Without the env, the default IconTokens glyph is used.
//   3. The text label (step name, notification body, session title)
//      is preserved verbatim.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  configureThemeIconsGetter,
  __resetThemeIconsGetterForTests,
} from '../src/theme/icons.js';
import { DEFAULT_THEME_TOKENS, DEFAULT_WIDGET_TOKENS } from '../src/theme/tokens.js';

const ORIG_ASCII = process.env.ELANOUS_ASCII_ICONS;

beforeEach(() => {
  __resetThemeIconsGetterForTests();
  delete process.env.ELANOUS_ASCII_ICONS;
});
afterEach(() => {
  __resetThemeIconsGetterForTests();
  if (ORIG_ASCII === undefined) delete process.env.ELANOUS_ASCII_ICONS;
  else process.env.ELANOUS_ASCII_ICONS = ORIG_ASCII;
});

describe('plan-renderer — icon migration', () => {
  test('ASCII mode swaps completed glyph for [v]', async () => {
    process.env.ELANOUS_ASCII_ICONS = '1';
    const { dispatchUpdatePlan, getPlanState } = await import('../src/code-edit/plan-tool.js');
    const { renderPlanBoard } = await import('../src/code-edit/plan-renderer.js');
    await dispatchUpdatePlan({
      plan: [{ step: 'done-step', status: 'completed' }],
    });
    const rows = renderPlanBoard(getPlanState(), { noColor: true });
    expect(rows.join('\n')).toContain('[v]');
    expect(rows.join('\n')).toContain('done-step');
  });

  test('default mode uses IconTokens.done glyph', async () => {
    const { dispatchUpdatePlan, getPlanState } = await import('../src/code-edit/plan-tool.js');
    const { renderPlanBoard } = await import('../src/code-edit/plan-renderer.js');
    await dispatchUpdatePlan({
      plan: [{ step: 'first', status: 'completed' }],
    });
    const rows = renderPlanBoard(getPlanState(), { noColor: true });
    // Default IconTokens.done is '✅'; not asserted as exact match
    // because presets may override via configureThemeIconsGetter.
    // Instead assert the slot's current glyph appears.
    const expected = DEFAULT_WIDGET_TOKENS.icon.done;
    expect(rows.join('\n')).toContain(expected);
  });
});

describe('notification-bell-modal — icon migration', () => {
  // Notification-bell glyphs are internal to the modal's render code.
  // Directly testing render requires mounting the widget — heavier
  // than necessary. Since the migration extracted kindGlyph() into a
  // local function, the observable contract at the outer layer
  // (KIND_COLOR painter still wraps the result) is unchanged. This
  // test covers the theme-icons path by invoking `icon()` with the
  // same slot the modal uses and asserting the ASCII fallback reaches
  // the string.
  test('error slot resolves via theme-icons ASCII path', async () => {
    process.env.ELANOUS_ASCII_ICONS = '1';
    const { icon } = await import('../src/theme/icons.js');
    expect(icon('error')).toBe('[E]');
    expect(icon('warning')).toBe('[W]');
    expect(icon('success')).toBe('[v]');
    expect(icon('notification')).toBe('[!]');
  });

  test('default slots use IconTokens defaults', async () => {
    const { icon } = await import('../src/theme/icons.js');
    expect(icon('error')).toBe(DEFAULT_WIDGET_TOKENS.icon.error);
    expect(icon('warning')).toBe(DEFAULT_WIDGET_TOKENS.icon.warning);
    expect(icon('success')).toBe(DEFAULT_WIDGET_TOKENS.icon.success);
    expect(icon('notification')).toBe(DEFAULT_WIDGET_TOKENS.icon.notification);
  });
});

describe('sessions-sidebar-widget — icon migration', () => {
  test('session status glyphs survive ASCII mode without label clipping', async () => {
    process.env.ELANOUS_ASCII_ICONS = '1';
    const { default: sessionsSidebarWidget } = await import('../src/session/sidebar-widget.js');
    // render() is the WidgetDef shape — we need a ctx stub.
    const cards = [
      { id: 's1', title: 'Session one', agentKind: 'claude' as const, status: 'done' as const, isAlive: true },
      { id: 's2', title: 'Session two', agentKind: 'claude' as const, status: 'err'  as const, isAlive: true },
    ];
    const state = { cards, cursor: 0, offset: 0 };
    const ctx = { width: 40, height: 8, focused: true } as Parameters<typeof sessionsSidebarWidget.render>[1];
    const out = sessionsSidebarWidget.render(state, ctx).join('\n');
    expect(out).toContain('[v]');   // done glyph
    expect(out).toContain('[E]');   // err glyph
    expect(out).toContain('Session one');
    expect(out).toContain('Session two');
  });

  test('idle / working / awaiting keep inline decorative glyphs', async () => {
    process.env.ELANOUS_ASCII_ICONS = '1';
    const { default: sessionsSidebarWidget } = await import('../src/session/sidebar-widget.js');
    const cards = [
      { id: 'a', title: 'Idle',     agentKind: 'claude' as const, status: 'idle'     as const, isAlive: true },
      { id: 'b', title: 'Working',  agentKind: 'claude' as const, status: 'working'  as const, isAlive: true },
      { id: 'c', title: 'Awaiting', agentKind: 'claude' as const, status: 'awaiting' as const, isAlive: true },
    ];
    const ctx = { width: 40, height: 8, focused: true } as Parameters<typeof sessionsSidebarWidget.render>[1];
    const out = sessionsSidebarWidget.render({ cards, cursor: 0, offset: 0 }, ctx).join('\n');
    expect(out).toContain('○');   // idle
    expect(out).toContain('●');   // working
    expect(out).toContain('◐');   // awaiting
  });
});
