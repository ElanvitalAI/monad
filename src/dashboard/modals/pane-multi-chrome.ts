import type { ThemeTokens } from '../../theme/tokens.js';
import { DEFAULT_CLOSE_GLYPH, DEFAULT_MINIMIZE_GLYPH } from '../../ui/chrome/control-glyphs.js';
import type {
  PaneMultiModalChromeControl,
  PaneMultiModalChromeSpec,
} from './pane-multi.js';

export interface PaneMultiChromeBaseSpec {
  theme: ThemeTokens;
  titlePrefix: string;
  titleControls: readonly PaneMultiModalChromeControl[];
  bottomStatus: string;
}

export interface PaneMultiLiveSnapshotChromeSpec {
  theme: ThemeTokens;
  titlePrefix: string;
  controlMode: PaneMultiChromeControlMode;
  subject: string;
  liveMode: boolean;
}

export type PaneMultiChromeControlMode = 'close-only' | 'model-close' | 'minimize-close';

export function resolvePaneMultiModalTitleControls(
  mode: PaneMultiChromeControlMode,
): readonly PaneMultiModalChromeControl[] {
  if (mode === 'minimize-close') {
    return [
      { id: 'minimize', label: DEFAULT_MINIMIZE_GLYPH },
      { id: 'close', label: DEFAULT_CLOSE_GLYPH },
    ];
  }
  if (mode === 'model-close') {
    return [
      { id: 'model', label: '⌥' },
      { id: 'close', label: DEFAULT_CLOSE_GLYPH },
    ];
  }
  return [{ id: 'close', label: DEFAULT_CLOSE_GLYPH }];
}

export function resolvePaneMultiLiveSnapshotStatus(
  subject: string,
  liveMode: boolean,
): string {
  return `${subject} · ${liveMode ? 'live' : 'snapshot'}`;
}

export function resolvePaneMultiLiveSnapshotChrome(
  spec: PaneMultiLiveSnapshotChromeSpec,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiModalChrome({
    theme: spec.theme,
    titlePrefix: spec.titlePrefix,
    titleControls: resolvePaneMultiModalTitleControls(spec.controlMode),
    bottomStatus: resolvePaneMultiLiveSnapshotStatus(spec.subject, spec.liveMode),
  });
}

export function resolvePaneMultiModalChrome(
  spec: PaneMultiChromeBaseSpec,
): PaneMultiModalChromeSpec {
  return {
    theme: spec.theme,
    variant: 'rounded',
    titleAlign: 'left',
    titlePrefix: spec.titlePrefix,
    titleControls: spec.titleControls,
    bottomStatus: spec.bottomStatus,
  };
}
