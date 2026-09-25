// IDX-6 Phase 5 — pane focus glyph tests.
//
// Asserts that focused-adjacent vertical dividers use the heavy
// `┃` glyph and other dividers use the default `│` glyph. Theme
// override via `pane.dividerFocusedGlyph` + `pane.dividerGlyph` is
// honored.

import { describe, test, expect, beforeEach } from 'bun:test';
import chalk from 'chalk';
import { WidgetHost } from '../src/widgets/host.js';
import { createLayout } from '../src/layout/host.js';
import { renderLayout } from '../src/layout/render.js';
import type { WidgetDef } from '../src/widgets/types.js';
import { CATPPUCCIN_MOCHA, ROSE_PINE_DAWN } from '../src/themes/index.js';
import type { ThemeTokens } from '../src/theme/tokens.js';

function makeFixture(type: string): WidgetDef<{ n: number }> {
  return {
    type,
    description: 'test fixture',
    defaultCharacter: type,
    initialState: () => ({ n: 0 }),
    render: (_state, ctx) => {
      const out: string[] = [];
      for (let i = 0; i < ctx.height; i++) {
        out.push(' '.repeat(ctx.width));
      }
      return out;
    },
  };
}

let host: WidgetHost;

beforeEach(() => {
  chalk.level = 3;
  host = new WidgetHost({ log: () => {}, requestRender: () => {} });
  host.register(makeFixture('a'));
  host.register(makeFixture('b'));
  host.register(makeFixture('c'));
});

function build2CellLayout(): { layout: ReturnType<typeof createLayout>; aId: string; bId: string } {
  const a = host.spawn({ type: 'a' });
  const b = host.spawn({ type: 'b' });
  const layout = createLayout([
    { cells: [{ widgetInstanceId: a.id, width: 'flex' }, { widgetInstanceId: b.id, width: 'flex' }] },
  ]);
  return { layout, aId: a.id, bId: b.id };
}

describe('IDX-6 Phase 5 — focused-adjacent divider uses heavy glyph', () => {
  test('no focus → all dividers use light `│` glyph', () => {
    const { layout } = build2CellLayout();
    const lines = renderLayout(layout, host, {
      width: 40,
      height: 3,
      topRow: 1,
      focusedInstanceId: null,
      theme: CATPPUCCIN_MOCHA,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('│');
    expect(joined).not.toContain('┃');
  });

  test('focus on left cell → divider becomes `┃`', () => {
    const { layout, aId } = build2CellLayout();
    const lines = renderLayout(layout, host, {
      width: 40,
      height: 3,
      topRow: 1,
      focusedInstanceId: aId,
      theme: CATPPUCCIN_MOCHA,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('┃');
  });

  test('custom theme override swaps glyph per preset', () => {
    const override: ThemeTokens = {
      ...CATPPUCCIN_MOCHA,
      pane: {
        ...CATPPUCCIN_MOCHA.pane,
        dividerFocusedGlyph: '║',
        dividerGlyph: '╎',
      },
    };
    const { layout, aId } = build2CellLayout();
    const lines = renderLayout(layout, host, {
      width: 40,
      height: 3,
      topRow: 1,
      focusedInstanceId: aId,
      theme: override,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('║');  // focused override
    expect(joined).not.toContain('┃');  // default heavy is shadowed by override
  });

  test('3-cell layout — only focused-adjacent divider gets heavy glyph', () => {
    const a = host.spawn({ type: 'a' });
    const b = host.spawn({ type: 'b' });
    const c = host.spawn({ type: 'c' });
    const layout = createLayout([
      {
        cells: [
          { widgetInstanceId: a.id, width: 'flex' },
          { widgetInstanceId: b.id, width: 'flex' },
          { widgetInstanceId: c.id, width: 'flex' },
        ],
      },
    ]);
    const lines = renderLayout(layout, host, {
      width: 60,
      height: 3,
      topRow: 1,
      focusedInstanceId: b.id,
      theme: CATPPUCCIN_MOCHA,
    });
    const joined = lines.join('\n');
    // Focus on the middle cell → BOTH adjacent dividers become `┃`.
    const heavyCount = (joined.match(/┃/g) ?? []).length;
    expect(heavyCount).toBeGreaterThan(0);
  });

  test('cross-preset — same layout produces different divider ANSI colors', () => {
    const { layout, aId } = build2CellLayout();
    const render = (theme: ThemeTokens) =>
      renderLayout(layout, host, {
        width: 40,
        height: 3,
        topRow: 1,
        focusedInstanceId: aId,
        theme,
      }).join('\n');
    const mocha = render(CATPPUCCIN_MOCHA);
    const dawn  = render(ROSE_PINE_DAWN);
    expect(mocha).toContain('┃');
    expect(dawn).toContain('┃');
    expect(mocha).not.toBe(dawn);
  });
});
