import { ansiForPair, type ChromeMotionPolicy, type ModalChromeWidgetTokens } from '../../theme/tokens.js';
import {
  resolveAffectiveChromeMotionPolicy,
  type AffectiveChromeState,
} from './affective-chrome-state.js';
import type { BoxViewOptions } from '../view.js';

export interface ModalChromeBoxSpec {
  title: string;
  titleRight?: string;
  titleAlign?: BoxViewOptions['titleAlign'];
  motionDisabled?: boolean;
  affectiveState?: AffectiveChromeState;
}

export interface ResolvedModalChromeMotion {
  mode: 'static' | 'motion';
  recipe: ChromeMotionPolicy['recipe'];
  target: ChromeMotionPolicy['target'];
}

export function resolveModalChromeMotion(
  chrome: ModalChromeWidgetTokens,
  opts: { motionDisabled?: boolean; affectiveState?: AffectiveChromeState } = {},
): ResolvedModalChromeMotion {
  const resolved = resolveAffectiveChromeMotionPolicy(
    chrome,
    opts.affectiveState ?? 'neutral',
    { motionDisabled: opts.motionDisabled },
  );
  return {
    mode: resolved.mode,
    recipe: resolved.recipe,
    target: resolved.target,
  };
}

export function resolveModalChromeBoxOptions(
  chrome: ModalChromeWidgetTokens,
  spec: ModalChromeBoxSpec,
): BoxViewOptions {
  const motion = resolveModalChromeMotion(chrome, {
    motionDisabled: spec.motionDisabled,
    affectiveState: spec.affectiveState,
  });
  const target = motion.target;
  const applyFrame = target === 'frame' || target === 'frame-and-title';
  const applyTitle = target === 'title-bar' || target === 'frame-and-title';
  const borderVariant = chrome.chromeVariant ?? 'plain';

  return {
    border: true,
    title: spec.title,
    titleAlign: spec.titleAlign,
    titleBarStyle: applyTitle ? ansiForPair(chrome.titleBarInactive ?? chrome.titleBar) : undefined,
    focusedTitleBarStyle: applyTitle ? ansiForPair(chrome.titleBar) : undefined,
    titleStyle: ansiForPair(chrome.titleTextInactive ?? chrome.titleText),
    focusedTitleStyle: ansiForPair(chrome.titleText),
    titleRight: spec.titleRight,
    titleRightStyle: ansiForPair(chrome.closeButton ?? chrome.titleText),
    focusedTitleRightStyle: ansiForPair(chrome.closeButton ?? chrome.titleText),
    style: ansiForPair(chrome.borderInactive),
    focusedStyle: ansiForPair(chrome.borderActive),
    borderVariant: applyFrame ? borderVariant : 'plain',
    focusedBorderVariant: applyFrame ? borderVariant : 'plain',
  };
}
