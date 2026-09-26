// IDX-6 Phase 2 — theme registry.
//
// Central entry point for looking up preset themes by name. The
// runtime theme service (IDX-6 Phase 3) will call listThemes() for
// the /theme list command and getTheme(name) when switching.
//
// Presets aim to span:
//   - dark base + standard accents     → catppuccin-mocha
//   - dark base + pastel accents       → mocha-pastel-accent
//   - light pastel (cool blue)         → catppuccin-latte
//   - light pastel (warm rose)         → rose-pine-dawn
//   - light pastel (cool arctic)       → nord-light
//   - light pastel (brand lavender)    → elanous-pastel-default

import type { ThemeTokens } from '../theme/tokens.js';
import {
  CATPPUCCIN_MOCHA,
  ADAPTIVE_PALETTE as MOCHA_ADAPTIVE_PALETTE,
} from './catppuccin-mocha.js';
import {
  CATPPUCCIN_LATTE,
  ADAPTIVE_PALETTE as LATTE_ADAPTIVE_PALETTE,
} from './catppuccin-latte.js';
import {
  ROSE_PINE_DAWN,
  ADAPTIVE_PALETTE as ROSE_PINE_ADAPTIVE_PALETTE,
} from './rose-pine-dawn.js';
import {
  NORD_LIGHT,
  ADAPTIVE_PALETTE as NORD_ADAPTIVE_PALETTE,
} from './nord-light.js';
import {
  ELANOUS_PASTEL_DEFAULT,
  ADAPTIVE_PALETTE as ELANOUS_ADAPTIVE_PALETTE,
} from './elanous-pastel-default.js';
import {
  MOCHA_PASTEL_ACCENT,
  ADAPTIVE_PALETTE as MOCHA_PASTEL_ADAPTIVE_PALETTE,
} from './mocha-pastel-accent.js';
import type { AdaptiveColor } from '../expression/color.js';

export {
  CATPPUCCIN_MOCHA,
  CATPPUCCIN_LATTE,
  ROSE_PINE_DAWN,
  NORD_LIGHT,
  ELANOUS_PASTEL_DEFAULT,
  MOCHA_PASTEL_ACCENT,
  MOCHA_ADAPTIVE_PALETTE,
  LATTE_ADAPTIVE_PALETTE,
  ROSE_PINE_ADAPTIVE_PALETTE,
  NORD_ADAPTIVE_PALETTE,
  ELANOUS_ADAPTIVE_PALETTE,
  MOCHA_PASTEL_ADAPTIVE_PALETTE,
};

/** expression-1 — registry of per-theme adaptive palettes keyed by
 *  the same string used by `getTheme(name)`. Renderers in
 *  `src/expression/` can `getThemeAdaptivePalette(theme.name)` to read
 *  AdaptiveColor entries for the active theme without each consumer
 *  importing every preset. */
export const ADAPTIVE_PALETTES_BY_THEME: ReadonlyMap<
  string,
  Readonly<Record<string, AdaptiveColor>>
> = new Map<string, Readonly<Record<string, AdaptiveColor>>>([
  [CATPPUCCIN_MOCHA.name, MOCHA_ADAPTIVE_PALETTE],
  [CATPPUCCIN_LATTE.name, LATTE_ADAPTIVE_PALETTE],
  [ROSE_PINE_DAWN.name, ROSE_PINE_ADAPTIVE_PALETTE],
  [NORD_LIGHT.name, NORD_ADAPTIVE_PALETTE],
  [ELANOUS_PASTEL_DEFAULT.name, ELANOUS_ADAPTIVE_PALETTE],
  [MOCHA_PASTEL_ACCENT.name, MOCHA_PASTEL_ADAPTIVE_PALETTE],
]);

export function getThemeAdaptivePalette(
  themeName: string,
): Readonly<Record<string, AdaptiveColor>> | null {
  return ADAPTIVE_PALETTES_BY_THEME.get(themeName) ?? null;
}

/** Ordered registry — dark first, then light pastels. The runtime
 *  switcher's `/theme list` output follows this order. */
export const THEME_REGISTRY: ReadonlyArray<ThemeTokens> = [
  CATPPUCCIN_MOCHA,
  MOCHA_PASTEL_ACCENT,
  CATPPUCCIN_LATTE,
  ROSE_PINE_DAWN,
  NORD_LIGHT,
  ELANOUS_PASTEL_DEFAULT,
];

/** Map of name → theme for O(1) lookup. Populated from THEME_REGISTRY
 *  on module load — keep order-sensitive callers on THEME_REGISTRY. */
const THEME_BY_NAME: ReadonlyMap<string, ThemeTokens> = new Map(
  THEME_REGISTRY.map((t) => [t.name, t] as const),
);

/** Look up a theme by name. Returns null when absent so callers can
 *  distinguish "unknown theme" from "default theme". */
export function getTheme(name: string): ThemeTokens | null {
  return THEME_BY_NAME.get(name) ?? null;
}

/** List registered theme names + metadata. Used by `/theme list`
 *  and by LLM tool `ListThemes` (IDX-6 Phase 7). */
export function listThemes(): ReadonlyArray<{
  name: string;
  isDark: boolean;
  isPastel: boolean;
}> {
  return THEME_REGISTRY.map((t) => ({
    name: t.name,
    isDark: t.isDark ?? false,
    isPastel: t.isPastel ?? false,
  }));
}

/** Default theme when config.theme.active is unset. Keeps the legacy
 *  Catppuccin Mocha baseline so existing users see no visual change. */
export const DEFAULT_REGISTRY_THEME = CATPPUCCIN_MOCHA;
