// ── F8 BoxDecoration default propagation · per-tier resolver ──
//
// ROADMAP-ui-core-separation §4 Phase S2.
//
// Centralises the "what does a dialog/popup/menu/terminal chrome look
// like by default" decision so individual modal call sites don't each
// re-invent a BoxDecoration. Themes opt in by populating
// `theme.chromeDefaults` — themes that don't ship the field keep the
// pre-S2 behaviour (no auto-applied chrome). The built-in shapes
// below are exported as reusable primitives that pastel themes can
// `copyWith` for their own palette.
//
// Contract
// ────────
//   resolveChromeDefault(tier, theme):
//     • Returns `undefined` for tiers that opt out (vw / execution /
//       picker / tooltip — host overlays, transparent layers, or
//       caller-managed chrome).
//     • Returns `theme.chromeDefaults?.[tier]` when the theme provides
//       one — themes own the look explicitly.
//     • Returns `undefined` when no theme override exists. Modal call
//       sites that want a guaranteed shape can fall back to
//       `BUILT_IN_CHROME_DEFAULTS[tier]` themselves; the resolver
//       deliberately stays passive so existing modals don't grow
//       chrome they didn't previously have just because a theme
//       loaded.
//
// debug.log junctions — chrome-defaults.resolve fires on every
// resolution attempt with the decision (theme override / no override /
// non-chrome tier).

import type { ModalTier } from '../display/types.js';
import { BoxDecoration } from './attributes/box-decoration.js';
import { BorderRadius, BorderSpec } from './attributes/border.js';
import { EdgeInsets } from './attributes/edge-insets.js';
import type { ThemeTokens } from '../theme/tokens.js';

/** Tiers that participate in chrome default propagation. `vw` and
 *  `execution` are host/overlay surfaces that paint their own
 *  background; `tooltip` is non-interactive. `picker` opts out today
 *  — the slash/arg picker manages its own ASCII chrome inside the
 *  composer. */
export type ChromeTier = 'dialog' | 'popup' | 'menu' | 'terminal';

/** Theme-side override map. Each tier may carry a fully-specified
 *  BoxDecoration — `border`, `borderRadius`, `padding`, `color`, and
 *  `boxShadow` are all read by the existing modal-adapter framing
 *  pipeline (`composeDecorationFrame`). */
export type ChromeDefaults = Partial<Record<ChromeTier, BoxDecoration>>;

/** Reusable baseline shapes. Themes that want a tier to look "normal
 *  but with my colour" can `BUILT_IN_CHROME_DEFAULTS.dialog.copyWith`.
 *  Border colour is set to `'border.focused'` so the resolver in
 *  `chrome/resolve-color.ts` maps it to `theme.colors.accent` — every
 *  registered theme exposes accent, so the baseline always paints. */
export const BUILT_IN_CHROME_DEFAULTS: Readonly<Record<ChromeTier, BoxDecoration>> = Object.freeze({
  dialog: new BoxDecoration({
    border: BorderSpec.all({ style: 'solid', color: 'border.focused' }),
    borderRadius: BorderRadius.circular(1),
    padding: EdgeInsets.all(1),
  }),
  popup: new BoxDecoration({
    border: BorderSpec.all({ style: 'solid', color: 'border.focused' }),
    borderRadius: BorderRadius.circular(1),
    padding: EdgeInsets.symmetric({ horizontal: 1 }),
  }),
  menu: new BoxDecoration({
    border: BorderSpec.all({ style: 'solid', color: 'border.focused' }),
    borderRadius: BorderRadius.circular(1),
    padding: EdgeInsets.symmetric({ horizontal: 1 }),
  }),
  terminal: new BoxDecoration({
    border: BorderSpec.all({ style: 'solid', color: 'border.focused' }),
    padding: EdgeInsets.zero,
  }),
});

/** Tier classifier. Returns true only for tiers that participate in
 *  chrome default propagation. */
export function isChromeTier(tier: ModalTier | undefined | null): tier is ChromeTier {
  return tier === 'dialog' || tier === 'popup' || tier === 'menu' || tier === 'terminal';
}

/** Resolve the BoxDecoration to auto-apply when a modal call site
 *  doesn't pass `decoration`. See module header for the full contract.
 *
 *  Returns `undefined` when:
 *    • `tier` is not a ChromeTier (non-chrome surfaces opt out).
 *    • `theme` is missing or has no `chromeDefaults`.
 *    • `theme.chromeDefaults` is missing the requested tier.
 *
 *  Returns the theme's `BoxDecoration` for the requested tier
 *  otherwise. */
export function resolveChromeDefault(
  tier: ModalTier | undefined | null,
  theme: ThemeTokens | undefined | null,
): BoxDecoration | undefined {
  if (!isChromeTier(tier)) return undefined;
  if (!theme || !theme.chromeDefaults) return undefined;
  return theme.chromeDefaults[tier];
}
