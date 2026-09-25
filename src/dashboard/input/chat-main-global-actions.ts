import type { TextInputGlobalAction } from '../../chat/index.js';

export interface ChatMainGlobalActionRunnerDeps {
  resizeLog: (delta: number, reset?: boolean) => void;
  focusLog: () => void;
  toggleLogZoom: () => void;
  copyLastBlock: () => void | Promise<void>;
  spawnTerminalModal: () => void;
  copyLogPane: () => void | Promise<void>;
  rotateProviderNext: () => void;
  /** Ctrl+L — 화면 클리어 + 전체 리페인트(대화 보존 · codex/CC 관례). */
  forceRedraw: () => void;
}

export function createChatMainGlobalActionRunner(
  deps: ChatMainGlobalActionRunnerDeps,
): (action: TextInputGlobalAction) => void | Promise<void> {
  return async (action) => {
    switch (action.kind) {
      case 'resize-log':
        deps.resizeLog(action.delta, action.reset);
        return;
      case 'goto-log':
        deps.focusLog();
        return;
      case 'toggle-log-zoom':
        deps.toggleLogZoom();
        return;
      case 'copy-last-block':
        await deps.copyLastBlock();
        return;
      case 'spawn-terminal-modal':
        deps.spawnTerminalModal();
        return;
      case 'copy-log-pane':
        await deps.copyLogPane();
        return;
      case 'provider-rotate-next':
        deps.rotateProviderNext();
        return;
      case 'force-redraw':
        deps.forceRedraw();
        return;
    }
  };
}
