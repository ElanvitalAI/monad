export interface CreateCompactSurfaceEffectsDeps {
  setChatModeHud: (enabled: boolean) => void;
  pushDebugLine: (line: string) => void;
  resetChatScroll: () => void;
  restoreStarterPanes: () => void;
  resetDashboardViewsConfig: () => void;
  muted: (text: string) => string;
  success: (text: string) => string;
}

export interface CompactSurfaceEffects {
  onChatOnlyEnabled: () => void;
  onChatOnlyDisabled: () => void;
  restoreStarterPanes: () => void;
  resetDashboardViewsConfig: () => void;
}

export function createCompactSurfaceEffects(
  deps: CreateCompactSurfaceEffectsDeps,
): CompactSurfaceEffects {
  return {
    onChatOnlyEnabled: () => {
      deps.setChatModeHud(true);
      deps.pushDebugLine(deps.muted('  chat-only layout enabled from dock menu.'));
      deps.resetChatScroll();
    },
    onChatOnlyDisabled: () => {
      deps.setChatModeHud(false);
      deps.pushDebugLine(deps.muted('  chat-only layout disabled from dock menu.'));
      deps.resetChatScroll();
    },
    restoreStarterPanes: () => {
      deps.restoreStarterPanes();
      deps.pushDebugLine(deps.muted('  current starter panes restored from view picker'));
      deps.resetChatScroll();
    },
    resetDashboardViewsConfig: () => {
      deps.resetDashboardViewsConfig();
      deps.pushDebugLine(deps.success('  dashboard view config reset to built-in defaults'));
      deps.resetChatScroll();
    },
  };
}
