import type { ThemeTokens } from '../../theme/tokens.js';
import { DEFAULT_CLOSE_GLYPH, DEFAULT_MINIMIZE_GLYPH } from '../../ui/chrome/control-glyphs.js';
import type {
  PaneMultiModalChromeControl,
  PaneMultiModalChromeSpec,
} from './pane-multi.js';
import { resolvePaneMultiModalChrome } from './pane-multi-chrome.js';

export type CompanionPopupControlMode = 'default' | 'no-promote';

export function resolveCompanionPopupTitleControls(
  mode: CompanionPopupControlMode = 'default',
): readonly PaneMultiModalChromeControl[] {
  if (mode === 'no-promote') {
    return [
      { id: 'minimize', label: DEFAULT_MINIMIZE_GLYPH },
      { id: 'close', label: DEFAULT_CLOSE_GLYPH },
    ];
  }
  return [
    { id: 'minimize', label: DEFAULT_MINIMIZE_GLYPH },
    { id: 'promote', label: '⇱' },
    { id: 'close', label: DEFAULT_CLOSE_GLYPH },
  ];
}

export interface CompanionPopupChromeSpec {
  theme: ThemeTokens;
  bottomStatus: string;
  titleControls?: readonly PaneMultiModalChromeControl[];
}

export function resolveCompanionPopupChrome(
  spec: CompanionPopupChromeSpec,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiModalChrome({
    theme: spec.theme,
    titlePrefix: '◌',
    titleControls: spec.titleControls ?? resolveCompanionPopupTitleControls(),
    bottomStatus: spec.bottomStatus,
  });
}

export function resolveWindowScopedCompanionPopupStatus(
  bottomStatus: string,
  windowId: number,
): string {
  return `${bottomStatus} · win:${windowId}`;
}

export interface WindowScopedCompanionPopupChromeSpec extends CompanionPopupChromeSpec {
  windowId: number;
}

export function resolveWindowScopedCompanionPopupChrome(
  spec: WindowScopedCompanionPopupChromeSpec,
): PaneMultiModalChromeSpec {
  return resolveCompanionPopupChrome({
    theme: spec.theme,
    titleControls: spec.titleControls,
    bottomStatus: resolveWindowScopedCompanionPopupStatus(spec.bottomStatus, spec.windowId),
  });
}
