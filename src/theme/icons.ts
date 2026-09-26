// IDX-6 Phase 6 — theme-icons formalization.
//
// `resolveIcon(theme, name)` in theme-tokens.ts already picks a glyph
// given a theme + IconTokens key, with ELANOUS_ASCII_ICONS=1 fallback.
// In practice almost no callsite used it — most code scattered raw
// emoji / glyphs inline. This module adds a thin coordination layer:
//
//   - `themedIcon(theme, name)` — explicit theme lookup (same as
//     resolveIcon, re-exported so downstream code imports from one
//     place)
//   - `paintedIcon(theme, name, slot?)` — glyph already wrapped in a
//     semantic painter (critical / warning / success / etc.) so the
//     common "paint an error badge" operation is one call
//   - `semanticForIcon(name)` — default mapping icon name → semantic
//     slot so `paintedIcon('error')` ⇒ red, `paintedIcon('warning')`
//     ⇒ amber, etc. without every caller restating the mapping
//   - `icon(name)` / `paintedIconCurrent(name)` — dashboard-scoped
//     convenience wrappers that use an injected theme getter. Hosts
//     call `configureThemeIconsGetter(() => currentThemeTokens())`
//     once at boot so every `icon()` call picks up the live theme.
//     Un-configured calls fall back to DEFAULT_THEME_TOKENS so tests
//     and early-init code don't crash.
//
// Importing from this module signals "this icon should be theme-
// aware + respect ELANOUS_ASCII_ICONS". Codebase migrations should
// replace hardcoded emoji with `paintedIcon` / `paintedIconCurrent`
// when the glyph carries semantic meaning (errors, warnings, state
// badges). Decorative glyphs (cursor '▸', separator '│') stay inline.

import {
  DEFAULT_THEME_TOKENS,
  paintPair,
  resolveIcon,
  resolveSemantic,
  type IconTokens,
  type SemanticTokens,
  type ThemeTokens,
} from './tokens.js';

export type IconName = keyof IconTokens;
export type SemanticKind = keyof SemanticTokens;

// ────────────────────────────────────────────────────────────────
// Core: explicit-theme variants. These carry zero ambient state.
// ────────────────────────────────────────────────────────────────

/** Resolve a glyph given an explicit theme. Identical to resolveIcon
 *  — re-exported so callsites import from one place (theme-icons). */
export function themedIcon(theme: ThemeTokens, name: IconName): string {
  return resolveIcon(theme, name);
}

/** Wrap a theme-resolved glyph in a semantic painter and return the
 *  painted string, ready for `printer.text(x, y, paintedIcon(...))`.
 *  The default semantic slot comes from `semanticForIcon(name)`;
 *  supply `slot` to override.
 *
 *  Example:
 *    p.text(0, y, paintedIcon(theme, 'error') + ' Migration failed');
 *    p.text(0, y, paintedIcon(theme, 'running', 'info') + ' Fetching…');
 */
export function paintedIcon(
  theme: ThemeTokens,
  name: IconName,
  slot?: SemanticKind,
): string {
  const glyph = resolveIcon(theme, name);
  const kind = slot ?? semanticForIcon(name);
  const painter = paintPair(resolveSemantic(theme, kind));
  return painter(glyph);
}

/** Default icon-name → semantic-slot mapping.
 *
 *  DD-IDX-15 guarantees the semantic hue stays meaningful across
 *  theme switches — `paintedIcon('error')` is always red-ish,
 *  regardless of whether the user is on mocha, latte, or pastel. */
export function semanticForIcon(name: IconName): SemanticKind {
  switch (name) {
    case 'error':
      return 'critical';
    case 'warning':
    case 'review':
      return 'warning';
    case 'success':
    case 'done':
      return 'success';
    case 'running':
    case 'notification':
      return 'info';
    case 'backlog':
    case 'locked':
      return 'muted';
    default:
      // agent / skill / task / goal / dashboard / terminal: no
      // inherent semantic colour. Use muted as a safe default.
      return 'muted';
  }
}

// ────────────────────────────────────────────────────────────────
// Dashboard-scoped convenience. Callers opt in by configuring a
// theme getter once; every subsequent icon() call routes through it.
// ────────────────────────────────────────────────────────────────

let ambientThemeGetter: (() => ThemeTokens | null | undefined) | null = null;

/** Register a getter that `icon()` + `paintedIconCurrent()` use.
 *  Typical wiring from dashboard.ts:
 *
 *    configureThemeIconsGetter(() => currentThemeTokens());
 *
 *  Calling again replaces the getter; passing null clears it and
 *  reverts to the DEFAULT_THEME_TOKENS fallback. */
export function configureThemeIconsGetter(
  getter: (() => ThemeTokens | null | undefined) | null,
): void {
  ambientThemeGetter = getter;
}

/** Ambient-theme glyph lookup. Safe to call before
 *  `configureThemeIconsGetter` — returns the DEFAULT_THEME_TOKENS
 *  glyph in that case so early-init code paths don't crash. */
export function icon(name: IconName): string {
  return themedIcon(readAmbientTheme(), name);
}

/** Ambient-theme painted icon — combines `icon(name)` with the
 *  default semantic colour. Equivalent to paintedIcon with the
 *  dashboard-theme threaded in. */
export function paintedIconCurrent(name: IconName, slot?: SemanticKind): string {
  return paintedIcon(readAmbientTheme(), name, slot);
}

function readAmbientTheme(): ThemeTokens {
  if (!ambientThemeGetter) return DEFAULT_THEME_TOKENS;
  try {
    const t = ambientThemeGetter();
    return t ?? DEFAULT_THEME_TOKENS;
  } catch {
    return DEFAULT_THEME_TOKENS;
  }
}

/** Test helper — drop the ambient getter so cases can set/unset
 *  without leaking into sibling tests. */
export function __resetThemeIconsGetterForTests(): void {
  ambientThemeGetter = null;
}
