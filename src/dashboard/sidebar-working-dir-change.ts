export interface DashboardSidebarWorkingDirChangeDeps<
  TWorkingDirState,
  TWorkingDir extends { remote?: { host: { name: string } } | null | undefined } = {
    remote?: { host: { name: string } } | null | undefined;
  },
> {
  workingDir: TWorkingDir;
  resolveTargetBrowser: (browserId: string | null | undefined) => TWorkingDirState;
  enterRemoteDirectory: (workingDir: TWorkingDir, absPath: string) => void;
  refreshRemoteWorkingDir: () => Promise<void>;
  refreshRemotePreviewBridge: () => Promise<void>;
  enterDirectory: (browser: TWorkingDirState, absPath: string) => void;
  refreshWorkingDir: (browser: TWorkingDirState) => void;
  refreshWorkingDirPreview: () => void;
  onLogLine: (line: string) => void;
  onAfterChange: () => void;
}

export function handleDashboardSidebarWorkingDirChange<
  TWorkingDirState,
  TWorkingDir extends { remote?: { host: { name: string } } | null | undefined },
>(
  absPath: string,
  browserId: string | null | undefined,
  deps: DashboardSidebarWorkingDirChangeDeps<TWorkingDirState, TWorkingDir>,
): void {
  const targetBrowser = deps.resolveTargetBrowser(browserId);
  if (deps.workingDir.remote) {
    deps.enterRemoteDirectory(deps.workingDir, absPath);
    void (async () => {
      await deps.refreshRemoteWorkingDir();
      await deps.refreshRemotePreviewBridge();
      deps.onAfterChange();
    })().catch(() => {});
    deps.onLogLine(`cd ${deps.workingDir.remote.host.name}:${absPath}`);
    deps.onAfterChange();
    return;
  }
  deps.enterDirectory(targetBrowser, absPath);
  deps.refreshWorkingDir(targetBrowser);
  deps.refreshWorkingDirPreview();
  deps.onLogLine(`cd ${(targetBrowser as { cwd?: string }).cwd ?? absPath}`);
  deps.onAfterChange();
}
