import type { NavCallbacks } from '../virtual-windows/navigation.js';

type VwSplitCallbacks = Pick<NavCallbacks, 'onSplit'>;

export interface DashboardVirtualWindowSplitRuntimeDeps {
  getCurrentWindow: () => {
    id: number;
    // method 문법(bivariant 파라미터) — 구체 VirtualWindow.splitFocused
    // (content: PaneContent) 를 그대로 수용. arrow-property 는 content:unknown
    // 이 PaneContent 로 contravariant 하게 좁혀지며 튕긴다.
    splitFocused(axis: 'h' | 'v', content: unknown): string;
  } | null | undefined;
  spawnTerminal: (spec: { title: string; cwd: string }) => {
    id: string;
    title: string;
    legacySessionId?: string | null;
  };
  cwd: () => string;
  detachSession: (id: string) => void;
  getCurrentTerminalModalId: () => string | null;
  clearCurrentTerminalModal: () => void;
  createTerminalSlotContent: (spec: { terminalId: string; title: string }) => unknown;
  bindSlot: (slotKey: string, paneId: string) => void;
  setPlacement: (terminalId: string, placement: { kind: 'vw'; windowId: string; slotId: string }) => void;
  pushMutedLine: (line: string) => void;
  pushWarningLine: (line: string) => void;
  draw: () => void;
}

export function createDashboardVirtualWindowSplitRuntime(
  deps: DashboardVirtualWindowSplitRuntimeDeps,
): VwSplitCallbacks {
  return {
    onSplit: (axis) => {
      const w = deps.getCurrentWindow();
      if (!w) {
        deps.pushMutedLine('No foreground virtual window to split.');
        return;
      }
      try {
        const inst = deps.spawnTerminal({
          title: `split-${axis}`,
          cwd: deps.cwd(),
        });
        if (inst.legacySessionId) {
          try { deps.detachSession(inst.legacySessionId); } catch {}
          if (deps.getCurrentTerminalModalId() === inst.legacySessionId) {
            deps.clearCurrentTerminalModal();
          }
        }
        const slotContent = deps.createTerminalSlotContent({
          terminalId: inst.id,
          title: inst.title,
        });
        const newPaneId = w.splitFocused(axis, slotContent);
        const windowIdStr = String(w.id);
        deps.bindSlot(`${windowIdStr}/${newPaneId}`, newPaneId);
        deps.setPlacement(inst.id, {
          kind: 'vw',
          windowId: windowIdStr,
          slotId: newPaneId,
        });
        deps.pushMutedLine(`  split ${axis}: ${inst.id} → pane:${newPaneId}`);
        deps.draw();
      } catch (err) {
        deps.pushWarningLine(`  split failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
