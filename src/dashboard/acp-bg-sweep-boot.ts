export interface DashboardAcpBgSweepBootDeps<BgManager> {
  enabled: boolean;
  backgroundManager: BgManager & {
    startAutoSweep(opts: { intervalMs: number; olderThanMs: number }): () => void;
  };
  intervalMs?: number;
  olderThanMs?: number;
}

export function bootDashboardAcpBgSweep<BgManager>(
  deps: DashboardAcpBgSweepBootDeps<BgManager>,
): void {
  if (!deps.enabled) return;
  deps.backgroundManager.startAutoSweep({
    intervalMs: deps.intervalMs ?? 60 * 60 * 1000,
    olderThanMs: deps.olderThanMs ?? 24 * 60 * 60 * 1000,
  });
}
