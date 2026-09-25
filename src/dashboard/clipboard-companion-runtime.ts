import type { ClipboardEntry } from '../clipboard/history.js';

export interface DashboardClipboardCompanionRuntimeDeps {
  resetCursor: () => void;
  pokeNow: () => Promise<void>;
  setOpen: (open: boolean) => void;
  writeClipboardText: (text: string) => Promise<boolean>;
  pushCopiedLine: (charCount: number) => void;
  pushCopyFailedLine: () => void;
}

export interface DashboardClipboardCompanionRuntime {
  open(): Promise<void>;
  close(): void;
  copyEntryAt(entries: readonly ClipboardEntry[], idx: number): Promise<void>;
}

export function createDashboardClipboardCompanionRuntime(
  deps: DashboardClipboardCompanionRuntimeDeps,
): DashboardClipboardCompanionRuntime {
  return {
    async open() {
      deps.resetCursor();
      await deps.pokeNow();
      deps.setOpen(true);
    },
    close() {
      deps.setOpen(false);
    },
    async copyEntryAt(entries, idx) {
      const sel = entries[idx];
      if (!sel) return;
      const ok = await deps.writeClipboardText(sel.text);
      if (ok) {
        deps.pushCopiedLine(sel.text.length);
        await deps.pokeNow();
        return;
      }
      deps.pushCopyFailedLine();
    },
  };
}
