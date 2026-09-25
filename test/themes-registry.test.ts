import { describe, expect, test } from 'bun:test';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  DEFAULT_REGISTRY_THEME,
  getTheme,
  listThemes,
  MOCHA_PASTEL_ACCENT,
  MONAD_PASTEL_DEFAULT,
  NORD_LIGHT,
  ROSE_PINE_DAWN,
  THEME_REGISTRY,
} from '../src/themes/index.js';
import { resolveSemantic, resolveWidgetTokens } from '../src/theme/tokens.js';

const ALL_PRESETS = [
  CATPPUCCIN_MOCHA,
  MOCHA_PASTEL_ACCENT,
  CATPPUCCIN_LATTE,
  ROSE_PINE_DAWN,
  NORD_LIGHT,
  MONAD_PASTEL_DEFAULT,
];

describe('IDX-6 Phase 2 theme registry', () => {
  test('registry contains all presets in dark-first order', () => {
    expect(THEME_REGISTRY.length).toBe(6);
    expect(THEME_REGISTRY[0]).toBe(CATPPUCCIN_MOCHA);
    expect(THEME_REGISTRY[1]).toBe(MOCHA_PASTEL_ACCENT);
  });

  test('getTheme looks up by name', () => {
    expect(getTheme('catppuccin-mocha')).toBe(CATPPUCCIN_MOCHA);
    expect(getTheme('catppuccin-latte')).toBe(CATPPUCCIN_LATTE);
    expect(getTheme('rose-pine-dawn')).toBe(ROSE_PINE_DAWN);
    expect(getTheme('nord-light')).toBe(NORD_LIGHT);
    expect(getTheme('monad-pastel-default')).toBe(MONAD_PASTEL_DEFAULT);
    expect(getTheme('mocha-pastel-accent')).toBe(MOCHA_PASTEL_ACCENT);
  });

  test('getTheme returns null for unknown names', () => {
    expect(getTheme('does-not-exist')).toBeNull();
    expect(getTheme('')).toBeNull();
  });

  test('DEFAULT_REGISTRY_THEME preserves the legacy mocha baseline', () => {
    expect(DEFAULT_REGISTRY_THEME).toBe(CATPPUCCIN_MOCHA);
    expect(DEFAULT_REGISTRY_THEME.name).toBe('catppuccin-mocha');
  });

  test('listThemes returns metadata for every registered theme', () => {
    const list = listThemes();
    expect(list.length).toBe(THEME_REGISTRY.length);
    const names = list.map((t) => t.name);
    expect(names).toContain('catppuccin-mocha');
    expect(names).toContain('catppuccin-latte');
    expect(names).toContain('rose-pine-dawn');
    expect(names).toContain('nord-light');
    expect(names).toContain('monad-pastel-default');
    expect(names).toContain('mocha-pastel-accent');
  });

  test('listThemes exposes isDark + isPastel flags correctly', () => {
    const map = new Map(listThemes().map((t) => [t.name, t] as const));
    expect(map.get('catppuccin-mocha')?.isDark).toBe(true);
    expect(map.get('catppuccin-mocha')?.isPastel).toBe(false);
    expect(map.get('catppuccin-latte')?.isDark).toBe(false);
    expect(map.get('catppuccin-latte')?.isPastel).toBe(true);
    expect(map.get('mocha-pastel-accent')?.isDark).toBe(true);
    expect(map.get('mocha-pastel-accent')?.isPastel).toBe(true);
  });
});

describe('IDX-6 Phase 2 preset completeness', () => {
  for (const theme of ALL_PRESETS) {
    test(`${theme.name} has all flat fields populated with valid hex`, () => {
      const hexRe = /^#[0-9a-fA-F]{6}$/;
      for (const v of Object.values(theme.colors)) expect(v).toMatch(hexRe);
      for (const v of Object.values(theme.pane)) expect(v).toMatch(hexRe);
      for (const v of Object.values(theme.modal)) expect(v).toMatch(hexRe);
      for (const v of Object.values(theme.cursor)) expect(v).toMatch(hexRe);
      for (const v of Object.values(theme.widget)) expect(v).toMatch(hexRe);
    });

    test(`${theme.name} ships full widgetTokens`, () => {
      expect(theme.widgetTokens).toBeDefined();
      const wt = theme.widgetTokens!;
      expect(wt.button.normal.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wt.dialog.border.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wt.selectView.cursor.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wt.modal.border.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wt.paneTitle.active.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(wt.statusBar.pill.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    test(`${theme.name} semantic.critical is red-dominant (DD-IDX-15)`, () => {
      const crit = resolveSemantic(theme, 'critical');
      const hex = crit.fg.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
    });

    test(`${theme.name} semantic.success is green-dominant`, () => {
      const succ = resolveSemantic(theme, 'success');
      const hex = succ.fg.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      expect(g).toBeGreaterThanOrEqual(r);
    });

    test(`${theme.name} provides all six button states`, () => {
      const btn = resolveWidgetTokens(theme, 'button');
      expect(btn.normal).toBeDefined();
      expect(btn.focused).toBeDefined();
      expect(btn.hovered).toBeDefined();
      expect(btn.disabled).toBeDefined();
      expect(btn.pressed).toBeDefined();
      expect(btn.highlighted).toBeDefined();
    });

    test(`${theme.name} icon map has every key`, () => {
      const icon = resolveWidgetTokens(theme, 'icon');
      const required: Array<keyof typeof icon> = [
        'terminal',
        'agent',
        'skill',
        'task',
        'notification',
        'goal',
        'dashboard',
        'warning',
        'error',
        'success',
        'running',
        'review',
        'backlog',
        'done',
        'locked',
      ];
      for (const k of required) expect(typeof icon[k]).toBe('string');
    });
  }

  test('no two presets share the same name', () => {
    const names = ALL_PRESETS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('pastel presets flag isPastel=true', () => {
    expect(CATPPUCCIN_LATTE.isPastel).toBe(true);
    expect(ROSE_PINE_DAWN.isPastel).toBe(true);
    expect(NORD_LIGHT.isPastel).toBe(true);
    expect(MONAD_PASTEL_DEFAULT.isPastel).toBe(true);
    expect(MOCHA_PASTEL_ACCENT.isPastel).toBe(true);
  });

  test('dark presets flag isDark=true', () => {
    expect(CATPPUCCIN_MOCHA.isDark).toBe(true);
    expect(MOCHA_PASTEL_ACCENT.isDark).toBe(true);
  });

  test('light presets flag isDark=false', () => {
    expect(CATPPUCCIN_LATTE.isDark).toBe(false);
    expect(ROSE_PINE_DAWN.isDark).toBe(false);
    expect(NORD_LIGHT.isDark).toBe(false);
    expect(MONAD_PASTEL_DEFAULT.isDark).toBe(false);
  });
});
