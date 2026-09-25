export type DashboardSubmitAction =
  | { kind: 'change-working-dir'; absPath: string; browserId?: string }
  | { kind: 'attach-file'; absPath: string; browserId?: string }
  | { kind: 'attach-folder'; absPath: string; browserId?: string }
  | { kind: 'toolbelt-action'; action: string; sessionId: string }
  | { kind: 'select-session'; sessionId: string }
  | { kind: 'log-text'; text: string };

export interface RunDashboardSubmitActionDeps {
  onChangeWorkingDir: (absPath: string, browserId?: string) => void;
  onAttachFile: (absPath: string, browserId?: string) => void;
  onAttachFolder: (absPath: string, browserId?: string) => void;
  onToolbeltAction: (action: string, sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onLogText: (text: string) => void;
}

function parseBrowserScopedPath(
  prefix: 'wd-cd:' | 'file-attach:' | 'folder-attach:',
  text: string,
): { absPath: string; browserId?: string } {
  const raw = text.slice(prefix.length);
  if (!raw.startsWith('@')) return { absPath: raw };
  const splitIdx = raw.indexOf(':');
  if (splitIdx <= 1) return { absPath: raw };
  return {
    browserId: raw.slice(1, splitIdx),
    absPath: raw.slice(splitIdx + 1),
  };
}

export function resolveDashboardSubmitAction(text: string): DashboardSubmitAction {
  if (text.startsWith('wd-cd:')) {
    return { kind: 'change-working-dir', ...parseBrowserScopedPath('wd-cd:', text) };
  }
  if (text.startsWith('file-attach:')) {
    return { kind: 'attach-file', ...parseBrowserScopedPath('file-attach:', text) };
  }
  if (text.startsWith('folder-attach:')) {
    return { kind: 'attach-folder', ...parseBrowserScopedPath('folder-attach:', text) };
  }
  if (text.startsWith('toolbelt:')) {
    const [, action = '', ...rest] = text.split(':');
    return {
      kind: 'toolbelt-action',
      action,
      sessionId: rest.join(':'),
    };
  }
  if (text.startsWith('session:')) {
    return { kind: 'select-session', sessionId: text.slice('session:'.length) };
  }
  return { kind: 'log-text', text };
}

export function runDashboardSubmitAction(
  action: DashboardSubmitAction,
  deps: RunDashboardSubmitActionDeps,
): void {
  switch (action.kind) {
    case 'change-working-dir':
      deps.onChangeWorkingDir(action.absPath, action.browserId);
      return;
    case 'attach-file':
      deps.onAttachFile(action.absPath, action.browserId);
      return;
    case 'attach-folder':
      deps.onAttachFolder(action.absPath, action.browserId);
      return;
    case 'toolbelt-action':
      deps.onToolbeltAction(action.action, action.sessionId);
      return;
    case 'select-session':
      deps.onSelectSession(action.sessionId);
      return;
    case 'log-text':
      deps.onLogText(action.text);
      return;
  }
}
