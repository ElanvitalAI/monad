import type { Key } from '../../tui.js';
import { debug } from '../../debug/log.js';

export type PaneCommonKeyRouteResult =
  | { type: 'handled' }
  | { type: 'quit' }
  | { type: 'passthrough' };

export interface PaneCommonKeyRouteDeps<Pane> {
  pane: Pane;
  tryConsumeEscape?: () => boolean | Promise<boolean>;
  enterInput: (opts: { rememberPane: boolean; mode?: 'plain' | 'slash'; reason: string }) => void;
  openAgentRosterSearch?: () => boolean;
  cyclePaneFocus: (delta: 1 | -1) => void;
  toggleLogFocus: () => void;
  hardExit: () => void;
  quit: () => void;
}

export async function routePaneCommonKey<Pane>(
  key: Key,
  deps: PaneCommonKeyRouteDeps<Pane>,
): Promise<PaneCommonKeyRouteResult> {
  if (key.name === 'escape') {
    if (await deps.tryConsumeEscape?.()) {
      debug.log('esc.abort', 'idle-pane-dispatch-consumed', {});
      return { type: 'handled' };
    }
    deps.enterInput({ rememberPane: true, reason: 'pane-escape' });
    return { type: 'handled' };
  }

  if (key.name === 'i' && !key.ctrl) {
    deps.enterInput({ rememberPane: true, reason: 'pane-i-key' });
    return { type: 'handled' };
  }

  // (Ctrl+L 입력 재진입 제거 — 2026-07-12. force-redraw 로 재정의 · entry-mode.ts 참조.)
  if (key.name === '/' && !key.ctrl) {
    if (deps.openAgentRosterSearch?.()) {
      return { type: 'handled' };
    }
    deps.enterInput({ rememberPane: true, mode: 'slash', reason: 'pane-slash-open-input' });
    return { type: 'handled' };
  }

  if (key.ctrl && (key.name === 'm' || key.name === 'ㅡ' || key.name === 't' || key.name === 'ㅅ')) {
    deps.enterInput({ rememberPane: true, reason: 'pane-ctrl-t-toggle' });
    return { type: 'handled' };
  }

  if (key.name === 'tab') {
    deps.cyclePaneFocus(key.shift ? -1 : 1);
    return { type: 'handled' };
  }

  if (key.name === '`') {
    deps.toggleLogFocus();
    return { type: 'handled' };
  }

  if (key.name === 'c' && key.ctrl) {
    deps.hardExit();
    return { type: 'handled' };
  }

  if (key.name === 'q' && !key.ctrl) {
    deps.quit();
    return { type: 'quit' };
  }

  return { type: 'passthrough' };
}
