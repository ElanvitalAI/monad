export type BellSubmitAction =
  | { kind: 'close' }
  | { kind: 'filter'; filter: 'u' | 'e' | 'a' }
  | { kind: 'focus-session'; sessionId: string };

export interface RunBellSubmitActionDeps {
  closeBell: () => void;
  setFilter: (filter: 'u' | 'e' | 'a') => void;
  focusSession: (sessionId: string) => void;
}

export function resolveBellSubmitAction(text: string): BellSubmitAction | null {
  if (text === 'bell:close') return { kind: 'close' };
  if (text === 'bell:filter:u') return { kind: 'filter', filter: 'u' };
  if (text === 'bell:filter:e') return { kind: 'filter', filter: 'e' };
  if (text === 'bell:filter:a') return { kind: 'filter', filter: 'a' };
  if (text.startsWith('bell:focus:')) {
    return { kind: 'focus-session', sessionId: text.slice('bell:focus:'.length) };
  }
  return null;
}

export function runBellSubmitAction(
  action: BellSubmitAction,
  deps: RunBellSubmitActionDeps,
): void {
  switch (action.kind) {
    case 'close':
      deps.closeBell();
      return;
    case 'filter':
      deps.setFilter(action.filter);
      return;
    case 'focus-session':
      deps.focusSession(action.sessionId);
      return;
  }
}
