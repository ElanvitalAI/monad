import type { ModalSurface } from '../display/modal-stack.js';
import {
  DEFAULT_HOST_CHROME_PROFILE,
  type HostChromeProfile,
} from '../display/host-chrome-profile.js';
import { bottomFixedRowsForPromptFrame } from '../display/prompt-frame.js';
import { isWorkspaceInteractionSurface } from '../display/surface-interaction-policy.js';

export interface DashboardHostChromePolicyInput {
  foregroundSurface: ModalSurface | null;
  blockingForegroundModal: ModalSurface | null;
  bottomAreaFreezeModal: ModalSurface | null;
}

export interface DashboardHostChromePolicy {
  suppressHudArea: boolean;
  suppressPromptArea: boolean;
  suppressStatusArea: boolean;
  suppressDashboardBackground: boolean;
  suppressDockArea: boolean;
  fixedDockRows: number;
  reservedBottomRows: number;
  foregroundHostChromeProfile: HostChromeProfile;
}

/**
 * Host chrome area policy.
 *
 * Treat dock / status / input as separate host-owned slots so later
 * product changes can:
 * - keep dock fixed while input/status float
 * - swap input onto a different pool
 * - merge status+input again
 *
 * Current contract:
 * - dock is always visible
 * - prompt/status can be suppressed by blocking modal / bottom freeze
 * - only `workspace`-class foregrounds suppress dashboard background
 *   zones; blocking popups do not replace the underlying workspace
 */
export function resolveDashboardHostChromePolicy(
  input: DashboardHostChromePolicyInput,
): DashboardHostChromePolicy {
  const foregroundHostChromeProfile =
    input.foregroundSurface?.hostChromeProfile ?? DEFAULT_HOST_CHROME_PROFILE;
  const dockOnlyForegroundWorkspace =
    isWorkspaceInteractionSurface(input.foregroundSurface)
    && foregroundHostChromeProfile === 'dock-only';
  const suppressPromptOrStatus =
    dockOnlyForegroundWorkspace
    || (
      foregroundHostChromeProfile === 'dock-only'
      && (input.blockingForegroundModal !== null || input.bottomAreaFreezeModal !== null)
    );
  return {
    suppressHudArea: foregroundHostChromeProfile === 'dock-only' && input.blockingForegroundModal !== null,
    suppressPromptArea: suppressPromptOrStatus,
    suppressStatusArea: suppressPromptOrStatus,
    suppressDashboardBackground: isWorkspaceInteractionSurface(input.foregroundSurface),
    suppressDockArea: false,
    fixedDockRows: 2,
    reservedBottomRows: reservedBottomRowsForHostChrome(foregroundHostChromeProfile),
    foregroundHostChromeProfile,
  };
}

export function defaultVirtualWindowBoundsForHostChrome(
  term: { cols: number; rows: number },
  policy: Partial<Pick<DashboardHostChromePolicy, 'reservedBottomRows' | 'fixedDockRows'>> = { fixedDockRows: 1 },
): { row: number; col: number; width: number; height: number } {
  const reservedBottomRows =
    ('reservedBottomRows' in policy
      ? policy.reservedBottomRows
      : policy.fixedDockRows) ?? 0;
  return {
    row: 1,
    col: 1,
    width: Math.max(2, term.cols),
    height: Math.max(2, term.rows - Math.max(0, reservedBottomRows)),
  };
}

export function reservedBottomRowsForHostChrome(
  profile: HostChromeProfile,
  promptInputHeight = 1,
): number {
  if (profile === 'hud-status-input-dock') {
    return 1 + bottomFixedRowsForPromptFrame(promptInputHeight);
  }
  return 2;
}
