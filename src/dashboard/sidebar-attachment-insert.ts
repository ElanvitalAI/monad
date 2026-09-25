export interface DashboardSidebarAttachmentInsertDeps {
  attachFilePathToken: (absPath: string) => Promise<string>;
  openFolderAttachModal: (absPath: string, onToken: (token: string) => void) => void;
  insertAtCursor: (token: string) => void;
}

export function handleDashboardSidebarAttachFile(
  absPath: string,
  deps: DashboardSidebarAttachmentInsertDeps,
): void {
  void (async () => {
    const token = await deps.attachFilePathToken(absPath);
    if (token) deps.insertAtCursor(token);
  })();
}

export function handleDashboardSidebarAttachFolder(
  absPath: string,
  deps: DashboardSidebarAttachmentInsertDeps,
): void {
  deps.openFolderAttachModal(absPath, (token) => {
    if (token) deps.insertAtCursor(token);
  });
}
