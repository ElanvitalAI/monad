// ColorScheme — adapter between the Phase 1 semantic ColorToken layer
// and the existing ThemeTokens infrastructure (src/theme-tokens.ts).
//
// Phase 2 (2026-04-19): widgets declare their styles via the 25
// ColorToken + 4 emphasis tier surface defined in widget-types.ts.
// Those tokens need to be resolved to terminal colors. This module
// wraps an existing ThemeTokens (Catppuccin Mocha, elanous-pastel, Nord
// Light, etc.) and exposes the ColorScheme API + ThemeRef
// implementation widgets expect.
//
// The 5 preset themes in src/themes/ already provide matured dark/
// light palettes — we do NOT re-invent them. ColorScheme.fromSeed
// (Material 3 tonal palette generation) is deferred to a follow-up
// arc; for now an application picks a preset by name.

import type {
  ColorToken,
  ColorEmphasis,
  PaletteColor,
  ThemeRef,
  ThemeExtension,
} from '../widgets/types.js';
import type { ThemeTokens } from './tokens.js';
import { tokenToPaletteColor, type TokenMapping } from './token-mapping.js';

/** Configuration for ColorScheme construction. */
export interface ColorSchemeConfig {
  /** Wraps this theme preset. Usually the active ThemeService's
   *  current tokens. */
  tokens: ThemeTokens;
  /** Optional custom token mapping — overrides or augments the
   *  default (tokenToPaletteColor). Useful for plugin themes that
   *  map some ColorToken to a plugin-specific color. */
  mapping?: TokenMapping;
}

/** ThemeRef implementation backed by a ThemeTokens preset. Widgets
 *  receive this via WidgetContext.theme. */
export class ColorScheme implements ThemeRef {
  readonly schemeName: string;
  readonly brightness: 'dark' | 'light';
  readonly #tokens: ThemeTokens;
  readonly #mapping?: TokenMapping;
  /** Keyed by the abstract class constructor (effectively `typeof T`).
   *  Stored as `unknown` because the recursive ThemeExtension<T extends
   *  ThemeExtension<T>> bound is too tight for a heterogeneous map —
   *  register/getExtension wrap the cast. */
  readonly #extensions = new Map<unknown, unknown>();

  constructor(config: ColorSchemeConfig) {
    this.#tokens = config.tokens;
    this.#mapping = config.mapping;
    this.schemeName = config.tokens.name;
    // isDark is optional on ThemeTokens; when absent, heuristic on
    // the palette's text color — lighter text implies dark theme.
    this.brightness = config.tokens.isDark === true
      ? 'dark'
      : config.tokens.isDark === false
        ? 'light'
        : this.#guessBrightness(config.tokens);
  }

  resolve(token: ColorToken, emphasis?: ColorEmphasis): PaletteColor {
    // Custom mapping wins if provided.
    if (this.#mapping) {
      const custom = this.#mapping[token];
      if (custom !== undefined) {
        return typeof custom === 'function' ? custom(this.#tokens, emphasis ?? 0) : custom;
      }
    }
    return tokenToPaletteColor(token, this.#tokens, emphasis ?? 0);
  }

  getExtension<T extends ThemeExtension<T>>(
    type: abstract new (...args: never[]) => T,
  ): T | null {
    const found = this.#extensions.get(type);
    return (found as unknown as T) ?? null;
  }

  /** Register a ThemeExtension<T> instance. Plugins call this after
   *  contributing their custom theme tokens. */
  registerExtension<T extends ThemeExtension<T>>(
    type: abstract new (...args: never[]) => T,
    extension: T,
  ): void {
    this.#extensions.set(type, extension);
  }

  /** Heuristic — if the first text color parses hexlike and > 50%
   *  brightness, call it dark (light text). Falls back to 'dark'
   *  because the default preset (Catppuccin Mocha) is dark. */
  #guessBrightness(tokens: ThemeTokens): 'dark' | 'light' {
    const text = tokens.colors.text;
    if (typeof text === 'string' && text.startsWith('#') && text.length === 7) {
      const r = parseInt(text.slice(1, 3), 16);
      const g = parseInt(text.slice(3, 5), 16);
      const b = parseInt(text.slice(5, 7), 16);
      const lum = (r + g + b) / 3;
      return lum > 128 ? 'dark' : 'light';
    }
    return 'dark';
  }
}

/** Construct a ColorScheme from a ThemeTokens preset. Convenience
 *  wrapper — equivalent to `new ColorScheme({ tokens })`. */
export function createColorScheme(config: ColorSchemeConfig): ColorScheme {
  return new ColorScheme(config);
}
