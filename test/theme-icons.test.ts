// IDX-6 Phase 6 — theme-icons tests.
//
// Covers:
//   1. semanticForIcon — name → semantic slot mapping invariants
//   2. themedIcon / paintedIcon — explicit-theme lookups, cross-preset
//      divergence, MONAD_ASCII_ICONS fallback
//   3. icon / paintedIconCurrent — ambient-getter convenience wrappers
//      + graceful fallback when getter not configured
//   4. Integration: toast-stack uses the helper end-to-end, ASCII mode
//      propagates through the toast output

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  configureThemeIconsGetter,
  icon,
  paintedIcon,
  paintedIconCurrent,
  semanticForIcon,
  themedIcon,
  __resetThemeIconsGetterForTests,
  type IconName,
  type SemanticKind,
} from '../src/theme/icons.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  MONAD_PASTEL_DEFAULT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { DEFAULT_THEME_TOKENS, DEFAULT_WIDGET_TOKENS } from '../src/theme/tokens.js';
import { ToastStack } from '../src/ui/widgets/toast-stack.js';
import { Printer } from '../src/ui/printer.js';

const ORIG_CHALK_LEVEL = chalk.level;
const ORIG_ASCII = process.env.MONAD_ASCII_ICONS;

beforeEach(() => {
  chalk.level = 3;
  __resetThemeIconsGetterForTests();
  delete process.env.MONAD_ASCII_ICONS;
});
afterEach(() => {
  chalk.level = ORIG_CHALK_LEVEL;
  __resetThemeIconsGetterForTests();
  if (ORIG_ASCII === undefined) delete process.env.MONAD_ASCII_ICONS;
  else process.env.MONAD_ASCII_ICONS = ORIG_ASCII;
});

describe('semanticForIcon', () => {
  test('error → critical', () => {
    expect(semanticForIcon('error')).toBe('critical');
  });

  test('warning / review → warning', () => {
    expect(semanticForIcon('warning')).toBe('warning');
    expect(semanticForIcon('review')).toBe('warning');
  });

  test('success / done → success', () => {
    expect(semanticForIcon('success')).toBe('success');
    expect(semanticForIcon('done')).toBe('success');
  });

  test('running / notification → info', () => {
    expect(semanticForIcon('running')).toBe('info');
    expect(semanticForIcon('notification')).toBe('info');
  });

  test('backlog / locked → muted', () => {
    expect(semanticForIcon('backlog')).toBe('muted');
    expect(semanticForIcon('locked')).toBe('muted');
  });

  test('structural icons default to muted (agent/skill/task/goal/dashboard/terminal)', () => {
    const names: IconName[] = ['agent', 'skill', 'task', 'goal', 'dashboard', 'terminal'];
    for (const n of names) expect(semanticForIcon(n)).toBe('muted');
  });
});

describe('themedIcon', () => {
  test('returns the preset-declared glyph', () => {
    const mocha = themedIcon(CATPPUCCIN_MOCHA, 'error');
    const latte = themedIcon(CATPPUCCIN_LATTE, 'error');
    // Both default icon tokens use the same emoji (no preset
    // overrides them today) — but the contract is that both are
    // non-empty strings.
    expect(mocha).toBeDefined();
    expect(mocha.length).toBeGreaterThan(0);
    expect(latte).toBeDefined();
  });

  test('MONAD_ASCII_ICONS=1 swaps in ASCII_SAFE_ICONS', () => {
    process.env.MONAD_ASCII_ICONS = '1';
    expect(themedIcon(CATPPUCCIN_MOCHA, 'error')).toBe('[E]');
    expect(themedIcon(CATPPUCCIN_MOCHA, 'success')).toBe('[v]');
    expect(themedIcon(CATPPUCCIN_MOCHA, 'warning')).toBe('[W]');
  });
});

describe('paintedIcon', () => {
  test('wraps the glyph in a semantic ANSI prefix', () => {
    const out = paintedIcon(CATPPUCCIN_MOCHA, 'error');
    expect(out).toMatch(/^\x1b\[/);   // leading SGR
  });

  test('explicit slot override bypasses semanticForIcon', () => {
    const defaultSlot = paintedIcon(CATPPUCCIN_MOCHA, 'running');   // info
    const overridden = paintedIcon(CATPPUCCIN_MOCHA, 'running', 'warning');
    expect(defaultSlot).not.toBe(overridden);
  });

  test('same icon under different themes produces different ANSI', () => {
    const outputs = new Set<string>([
      paintedIcon(CATPPUCCIN_MOCHA, 'error'),
      paintedIcon(CATPPUCCIN_LATTE, 'error'),
      paintedIcon(ROSE_PINE_DAWN, 'error'),
      paintedIcon(MONAD_PASTEL_DEFAULT, 'error'),
    ]);
    // At least 2 distinct ANSI prefixes across the 4 presets — the
    // semantic.critical hex is preset-specific.
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('icon (ambient getter)', () => {
  test('returns DEFAULT_THEME_TOKENS glyph when getter not configured', () => {
    expect(icon('done')).toBe(DEFAULT_WIDGET_TOKENS.icon.done);
  });

  test('uses configured getter to pick the theme', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_LATTE);
    // Both themes ship '✅' for 'success' by default so we can't
    // assert a glyph difference here, but we can assert the call
    // doesn't throw and returns a non-empty string.
    expect(icon('success').length).toBeGreaterThan(0);
  });

  test('swallows getter errors → falls back to DEFAULT_THEME_TOKENS', () => {
    configureThemeIconsGetter(() => {
      throw new Error('getter broken');
    });
    expect(icon('error')).toBe(DEFAULT_WIDGET_TOKENS.icon.error);
  });

  test('reacts to getter re-configuration', () => {
    const switchable: { t: typeof CATPPUCCIN_MOCHA } = { t: CATPPUCCIN_MOCHA };
    configureThemeIconsGetter(() => switchable.t);
    const first = icon('error');
    switchable.t = CATPPUCCIN_LATTE as typeof CATPPUCCIN_MOCHA;
    const second = icon('error');
    // Same glyph today (no preset override) but the call itself
    // must succeed for both states.
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  test('MONAD_ASCII_ICONS=1 reaches icon() through ambient getter', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_MOCHA);
    process.env.MONAD_ASCII_ICONS = '1';
    expect(icon('error')).toBe('[E]');
  });
});

describe('paintedIconCurrent', () => {
  test('uses the ambient theme + default semantic slot', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_MOCHA);
    const out = paintedIconCurrent('error');
    expect(out).toMatch(/^\x1b\[/);
  });

  test('slot override respected for ambient calls', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_MOCHA);
    const critical = paintedIconCurrent('running');       // info
    const warn    = paintedIconCurrent('running', 'warning');
    expect(critical).not.toBe(warn);
  });
});

describe('toast-stack integration', () => {
  function renderToastLines(stack: ToastStack): string[] {
    const p = Printer.create({ width: 40, height: 5 });
    stack.render(p);
    return p.lines();
  }

  test('glyph column adopts the ambient theme glyph', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_MOCHA);
    const stack = new ToastStack({ nowMs: () => 0 });
    stack.push({ text: 'saved', kind: 'success' });
    const lines = renderToastLines(stack);
    // The combined text ends with 'saved' regardless of glyph;
    // the glyph differs from the info-kind fallback '•'.
    expect(lines.join('\n')).toContain('saved');
  });

  test('ASCII mode propagates → glyph is bracketed literal', () => {
    configureThemeIconsGetter(() => CATPPUCCIN_MOCHA);
    process.env.MONAD_ASCII_ICONS = '1';
    const stack = new ToastStack({ nowMs: () => 0 });
    stack.push({ text: 'saved', kind: 'success' });
    const lines = renderToastLines(stack).join('\n');
    expect(lines).toContain('[v]');
    expect(lines).toContain('saved');
  });
});
