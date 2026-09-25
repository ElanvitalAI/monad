import type { PaneFocus } from '../../workspace-types.js';

export interface LegacyForegroundModalDemotionTransition {
  nextFocus: PaneFocus;
  reason: string;
}

export interface LegacyForegroundModalFocusPlan {
  anchorPane: PaneFocus;
  demotionTransition: LegacyForegroundModalDemotionTransition | null;
}

export function resolveLegacyForegroundModalFallbackPane(
  preferred: PaneFocus | null,
  lastWorkingDirPane: PaneFocus | null,
  fallbackPane: PaneFocus,
): PaneFocus {
  if (preferred && preferred !== 'input') return preferred;
  if (lastWorkingDirPane && lastWorkingDirPane !== 'input') return lastWorkingDirPane;
  return fallbackPane;
}

export function shouldDemoteLegacyInputFocusForForegroundModal(
  workingFocus: PaneFocus,
): boolean {
  return workingFocus === 'input';
}

export function resolveLegacyForegroundModalDemotionTransition(opts: {
  workingFocus: PaneFocus;
  preferred: PaneFocus | null;
  lastWorkingDirPane: PaneFocus | null;
  fallbackPane: PaneFocus;
  reason: string;
}): LegacyForegroundModalDemotionTransition | null {
  if (!shouldDemoteLegacyInputFocusForForegroundModal(opts.workingFocus)) return null;
  return {
    nextFocus: resolveLegacyForegroundModalFallbackPane(
      opts.preferred,
      opts.lastWorkingDirPane,
      opts.fallbackPane,
    ),
    reason: opts.reason,
  };
}

export function resolveLegacyForegroundModalFocusPlan(opts: {
  workingFocus: PaneFocus;
  preferred: PaneFocus | null;
  lastWorkingDirPane: PaneFocus | null;
  fallbackPane: PaneFocus;
  reason: string;
}): LegacyForegroundModalFocusPlan {
  return {
    anchorPane: resolveLegacyForegroundModalFallbackPane(
      opts.preferred,
      opts.lastWorkingDirPane,
      opts.fallbackPane,
    ),
    demotionTransition: resolveLegacyForegroundModalDemotionTransition(opts),
  };
}
