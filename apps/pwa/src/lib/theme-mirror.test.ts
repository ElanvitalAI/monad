import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_REGISTRY } from '../../../../src/themes/index.js';
import type { ThemeTokens } from '../../../../src/theme/tokens.js';

const GLOBALS_CSS = readFileSync(resolve(import.meta.dir, '../app/globals.css'), 'utf8');
const THEME_PROVIDER = readFileSync(resolve(import.meta.dir, '../components/providers/ThemeProvider.tsx'), 'utf8');

type Mapping = Readonly<{
  cssVariable: string;
  tokenValue: (theme: ThemeTokens) => string;
}>;

type Mismatch = Readonly<{
  cssVariable: string;
  cssValue: string;
  tokenValue: string;
}>;

type ThemeAudit = Readonly<{
  name: string;
  compared: number;
  measured: boolean;
  mismatches: readonly Mismatch[];
}>;

type ThemeListAudit = Readonly<{
  compared: number;
  measured: boolean;
  mismatches: readonly string[];
}>;

// Mirrors the token mapping policy in globals.css. Background and inverse
// foreground use per-theme conventions rather than ThemeTokens fields.
const MAPPINGS: readonly Mapping[] = [
  { cssVariable: '--foreground', tokenValue: (theme) => theme.colors.text },
  { cssVariable: '--muted-foreground', tokenValue: (theme) => theme.colors.muted },
  { cssVariable: '--primary', tokenValue: (theme) => theme.colors.accent },
  { cssVariable: '--ring', tokenValue: (theme) => theme.colors.accent },
  { cssVariable: '--sidebar-primary', tokenValue: (theme) => theme.colors.accent },
  { cssVariable: '--accent', tokenValue: (theme) => theme.colors.highlight },
  { cssVariable: '--destructive', tokenValue: (theme) => theme.colors.error },
  { cssVariable: '--secondary', tokenValue: (theme) => theme.widget.selected },
  { cssVariable: '--muted', tokenValue: (theme) => theme.widget.selected },
  { cssVariable: '--border', tokenValue: (theme) => theme.colors.dim },
  { cssVariable: '--input', tokenValue: (theme) => theme.colors.dim },
  { cssVariable: '--chart-1', tokenValue: (theme) => theme.colors.accent },
  { cssVariable: '--chart-2', tokenValue: (theme) => theme.colors.success },
  { cssVariable: '--chart-3', tokenValue: (theme) => theme.colors.warning },
  { cssVariable: '--chart-4', tokenValue: (theme) => theme.colors.info },
  { cssVariable: '--chart-5', tokenValue: (theme) => theme.colors.highlight },
];

function cssBlock(source: string, themeName: string): string | null {
  const selector = themeName === 'catppuccin-mocha'
    ? ':root,\\s*\\[data-theme=[\'\"]catppuccin-mocha[\'\"]\\]'
    : `\\[data-theme=[\'\"]${themeName}[\'\"]\\]`;
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  return match?.[1] ?? null;
}

function cssVariables(block: string): ReadonlyMap<string, string> {
  const variables = new Map<string, string>();
  for (const match of block.matchAll(/(^|\n)\s*(--[\w-]+)\s*:\s*([^;]+);/g)) {
    variables.set(match[2]!, match[3]!.trim());
  }
  return variables;
}

function auditThemeMirror(source: string, themes: readonly ThemeTokens[]): readonly ThemeAudit[] {
  return themes.map((theme) => {
    const block = cssBlock(source, theme.name);
    if (!block) return { name: theme.name, compared: 0, measured: false, mismatches: [] };

    const variables = cssVariables(block);
    const mismatches = MAPPINGS.flatMap((mapping) => {
      const cssValue = variables.get(mapping.cssVariable);
      const tokenValue = mapping.tokenValue(theme);
      return cssValue === undefined || cssValue.toLowerCase() !== tokenValue.toLowerCase()
        ? [{ cssVariable: mapping.cssVariable, cssValue: cssValue ?? '<missing>', tokenValue }]
        : [];
    });

    return { name: theme.name, compared: MAPPINGS.length, measured: true, mismatches };
  });
}

function themeProviderNames(source: string): readonly string[] | null {
  const declaration = /export const THEMES\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(source);
  if (!declaration) return null;
  return [...declaration[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

function auditThemeProviderMirror(source: string, themes: readonly ThemeTokens[]): ThemeListAudit {
  const names = themeProviderNames(source);
  if (!names) return { compared: 0, measured: false, mismatches: [] };

  const canonical = new Set(themes.map((theme) => theme.name));
  const selectable = new Set(names);
  const mismatches = [
    ...[...canonical].filter((name) => !selectable.has(name)),
    ...[...selectable].filter((name) => !canonical.has(name)),
  ];

  return { compared: canonical.size, measured: true, mismatches };
}

describe('PWA theme token mirror', () => {
  test('every registered theme has a measured CSS block and matching policy tokens', () => {
    const audits = auditThemeMirror(GLOBALS_CSS, THEME_REGISTRY);
    console.log(`[theme-mirror] ${audits.map((audit) => `${audit.name}:${audit.compared}`).join(', ')}`);

    expect(audits).toHaveLength(THEME_REGISTRY.length);
    expect(audits.every((audit) => audit.measured && audit.compared > 0)).toBe(true);
    expect(audits.flatMap((audit) => audit.mismatches)).toEqual([]);
  });

  test('a changed source token reports its CSS variable and both values', () => {
    const sourceTheme = THEME_REGISTRY[0]!;
    const alteredTheme: ThemeTokens = {
      ...sourceTheme,
      colors: { ...sourceTheme.colors, accent: '#000000' },
    };
    const mismatch = auditThemeMirror(GLOBALS_CSS, [alteredTheme])[0]!.mismatches
      .find((candidate) => candidate.cssVariable === '--primary');

    expect(mismatch).toEqual({
      cssVariable: '--primary',
      cssValue: sourceTheme.colors.accent,
      tokenValue: '#000000',
    });
  });

  test('a missing CSS theme block is reported as unmeasured, not matching', () => {
    const removedTheme = THEME_REGISTRY[1]!;
    const withoutTheme = GLOBALS_CSS.replaceAll(
      `[data-theme='${removedTheme.name}']`,
      `[data-theme='${removedTheme.name}-missing']`,
    );
    const audit = auditThemeMirror(withoutTheme, [removedTheme])[0]!;

    expect(audit).toMatchObject({ name: removedTheme.name, compared: 0, measured: false, mismatches: [] });
  });

  test('ThemeProvider literal themes are a measured non-empty set matching the registry', () => {
    const audit = auditThemeProviderMirror(THEME_PROVIDER, THEME_REGISTRY);

    expect(audit).toMatchObject({ compared: THEME_REGISTRY.length, measured: true, mismatches: [] });
    expect(audit.compared).toBeGreaterThan(0);
  });

  test('a missing canonical ThemeProvider theme reports the missing name', () => {
    const missingName = THEME_REGISTRY[0]!.name;
    const withoutTheme = THEME_PROVIDER.replace(`  '${missingName}',\n`, '');
    const audit = auditThemeProviderMirror(withoutTheme, THEME_REGISTRY);

    expect(audit.mismatches).toContain(missingName);
  });

  test('an extra non-canonical ThemeProvider theme reports the extra name', () => {
    const extraName = 'not-a-canonical-theme';
    const withExtraTheme = THEME_PROVIDER.replace('] as const;', `  '${extraName}',\n] as const;`);
    const audit = auditThemeProviderMirror(withExtraTheme, THEME_REGISTRY);

    expect(audit.mismatches).toContain(extraName);
  });

  test('an unlocatable ThemeProvider THEMES declaration is unmeasured, not matching', () => {
    const withoutDeclaration = THEME_PROVIDER.replace('export const THEMES', 'export const SELECTABLE_THEMES');
    const audit = auditThemeProviderMirror(withoutDeclaration, THEME_REGISTRY);

    expect(audit).toEqual({ compared: 0, measured: false, mismatches: [] });
  });
});
