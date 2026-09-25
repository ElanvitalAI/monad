// Theme — public barrel for the Phase 2 presentation infrastructure.
//
// Adapter between the Phase 1 semantic ColorToken × emphasis surface
// (widget-types.ts) and the existing ThemeTokens preset system
// (theme-tokens.ts + themes/). New widgets should import from here;
// the legacy C.* color-helper API remains valid for unmigrated code.

export {
  ColorScheme,
  createColorScheme,
  type ColorSchemeConfig,
} from './color-scheme.js';

export {
  tokenToPaletteColor,
  type TokenMapping,
} from './token-mapping.js';
