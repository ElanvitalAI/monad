export interface DashboardInputCoreBootDeps {
  initPaneSubstrate: () => unknown;
  registerCaptureRuntimes: () => unknown;
  wireAutoModeContextBridge: () => unknown;
  wireAndonContextBridge: () => unknown;
  wireBudgetContextBridge: () => unknown;
  wirePlanModeContextBridge: () => unknown;
  wireInputModeContextBridge: () => unknown;
  initInputCoreUserBindings: (deps: {
    report: (ev: unknown) => void;
  }) => { initial: unknown; dispose: () => void };
  report: (ev: unknown) => void;
}

export function bootDashboardInputCore(
  deps: DashboardInputCoreBootDeps,
): { initial: unknown; dispose: () => void } | null {
  try { deps.initPaneSubstrate(); } catch {}
  try { deps.registerCaptureRuntimes(); } catch {}
  try { deps.wireAutoModeContextBridge(); } catch {}
  try { deps.wireAndonContextBridge(); } catch {}
  try { deps.wireBudgetContextBridge(); } catch {}
  try { deps.wirePlanModeContextBridge(); } catch {}
  try { deps.wireInputModeContextBridge(); } catch {}
  try {
    return deps.initInputCoreUserBindings({ report: deps.report });
  } catch {
    return null;
  }
}
