import type { ChromeMotionPolicy, ModalChromeWidgetTokens } from '../../theme/tokens.js';

export type AffectiveChromeState =
  | 'neutral'
  | 'thinking'
  | 'listening'
  | 'replying'
  | 'urgent'
  | 'approval-required'
  | 'tentative';

export function resolveAffectiveChromeMotionPolicy(
  chrome: ModalChromeWidgetTokens,
  state: AffectiveChromeState = 'neutral',
  opts: { motionDisabled?: boolean } = {},
): ChromeMotionPolicy {
  const base: ChromeMotionPolicy = chrome.motionPolicy ?? {
    mode: 'static',
    recipe: 'focus-swap',
    target: chrome.chromeTarget ?? 'frame-and-title',
  };

  const preferred = resolvePreferredPolicy(base, state);
  if (opts.motionDisabled) {
    return {
      mode: 'static',
      recipe: preferred.recipe,
      target: preferred.target,
    };
  }
  return preferred;
}

function resolvePreferredPolicy(
  base: ChromeMotionPolicy,
  state: AffectiveChromeState,
): ChromeMotionPolicy {
  switch (state) {
    case 'thinking':
      return { mode: 'motion', recipe: 'pulse', target: 'title-bar' };
    case 'listening':
      return { mode: 'motion', recipe: 'pulse', target: 'title-bar' };
    case 'replying':
      return { mode: 'motion', recipe: 'sweep', target: 'frame' };
    case 'urgent':
      return { mode: 'motion', recipe: 'pulse', target: 'frame-and-title' };
    case 'approval-required':
      return { mode: 'motion', recipe: 'audit-pulse', target: 'title-bar' };
    case 'tentative':
      return { mode: 'static', recipe: 'focus-swap', target: 'title-bar' };
    case 'neutral':
    default:
      return base;
  }
}
