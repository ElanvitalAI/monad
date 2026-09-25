import type { ThemeTokens } from '../../theme/tokens.js';
import type { PaneMultiModalChromeSpec } from './pane-multi.js';
import {
  resolvePaneMultiModalChrome,
  resolvePaneMultiModalTitleControls,
} from './pane-multi-chrome.js';

export function resolveDebugPaneMultiChrome(
  theme: ThemeTokens,
  bottomStatus: string,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiModalChrome({
    theme,
    titlePrefix: '⚙',
    titleControls: resolvePaneMultiModalTitleControls('minimize-close'),
    bottomStatus,
  });
}

export function resolveDebugWorkbenchStatus(): string {
  return 'debug · 2x2 · events/detail/activity/prompts';
}

export function resolveDebugWindowStatus(
  mirrorEnabled: boolean,
): string {
  return mirrorEnabled
    ? 'debug companion · live mirror · hover to inspect'
    : 'debug companion · file trail only · /debug on to stream';
}
