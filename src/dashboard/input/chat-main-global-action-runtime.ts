import {
  createChatMainGlobalActionRunner,
} from './chat-main-global-actions.js';

export interface DashboardChatMainGlobalActionRuntimeDeps {
  nudgeLogHeightBias: (delta: number) => void;
  resetLogHeightBias: () => void;
  recomputePaneHeight: () => void;
  focusLog: () => void;
  toggleLogZoom: () => void;
  copyLastBlock: () => void | Promise<void>;
  spawnTerminalModal: () => void;
  copyLogPane: () => void | Promise<void>;
  rotateProviderNext: () => void;
  forceRedraw: () => void;
}

export function createDashboardChatMainGlobalActionRuntime(
  deps: DashboardChatMainGlobalActionRuntimeDeps,
): ReturnType<typeof createChatMainGlobalActionRunner> {
  return createChatMainGlobalActionRunner({
    resizeLog: (delta, reset) => {
      if (reset) deps.resetLogHeightBias();
      else deps.nudgeLogHeightBias(delta);
      deps.recomputePaneHeight();
    },
    focusLog: deps.focusLog,
    toggleLogZoom: deps.toggleLogZoom,
    copyLastBlock: deps.copyLastBlock,
    spawnTerminalModal: deps.spawnTerminalModal,
    copyLogPane: deps.copyLogPane,
    rotateProviderNext: deps.rotateProviderNext,
    forceRedraw: deps.forceRedraw,
  });
}
