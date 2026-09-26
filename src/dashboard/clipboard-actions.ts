import { writeClipboard, writeClipboardDetailed, type ClipboardWriteResult } from '../clipboard/index.js';
import { C, stripAnsi } from '../tui.js';

export interface DashboardClipboardHud {
  setCopied: (text: string) => void;
  clearCopied: () => void;
}

export interface DashboardClipboardActionsDeps {
  getChatLines: () => readonly string[];
  findBlock: (lines: string[], cursorIdx: number) => { start: number; end: number } | null;
  pushDebugLine: (line: string) => void;
  pushChatLine: (line: string) => void;
  clearChatScroll: () => void;
  hud: DashboardClipboardHud;
  draw: () => void;
  scheduleTimeout?: (cb: () => void, delayMs: number) => void;
  writeClipboardDetailed?: typeof writeClipboardDetailed;
  writeClipboard?: typeof writeClipboard;
}

export interface DashboardClipboardActions {
  copyLogBlock: (anchorIdx: number, scope: 'block' | 'all') => Promise<void>;
  copyRootPathToLog: (path: string | null | undefined, label?: string) => Promise<void>;
}

export function createDashboardClipboardActions(
  deps: DashboardClipboardActionsDeps,
): DashboardClipboardActions {
  return {
    copyLogBlock: async (anchorIdx, scope) => {
      let toCopy: readonly string[];
      if (scope === 'all') {
        toCopy = deps.getChatLines();
      } else {
        const range = deps.findBlock([...deps.getChatLines()], anchorIdx);
        if (!range) {
          deps.pushChatLine(C.warning('(nothing to copy)'));
          deps.clearChatScroll();
          return;
        }
        toCopy = deps.getChatLines().slice(range.start, range.end);
      }
      const plain = toCopy.map(stripAnsi).join('\n');
      const result = await (deps.writeClipboardDetailed ?? writeClipboardDetailed)(plain);
      handleDetailedClipboardResult(result, {
        lineCount: toCopy.length,
        pushDebugLine: deps.pushDebugLine,
        hud: deps.hud,
        draw: deps.draw,
        scheduleTimeout: deps.scheduleTimeout,
      });
    },
    copyRootPathToLog: async (path, label = 'path') => {
      if (!path) {
        deps.pushDebugLine(C.warning(`  (no ${label} to copy)`));
        deps.draw();
        return;
      }
      const ok = await (deps.writeClipboard ?? writeClipboard)(path);
      if (ok) {
        deps.pushDebugLine(C.success('  \u2713 copied ') + C.muted(`${label}: `) + C.text(path));
        flashCopiedHud({
          hud: deps.hud,
          draw: deps.draw,
          scheduleTimeout: deps.scheduleTimeout,
          text: C.success('copied'),
        });
      } else {
        deps.pushDebugLine(C.warning('  (clipboard write failed — install xclip/wl-copy?)'));
        deps.draw();
      }
    },
  };
}

function handleDetailedClipboardResult(
  result: ClipboardWriteResult,
  deps: {
    lineCount: number;
    pushDebugLine: (line: string) => void;
    hud: DashboardClipboardHud;
    draw: () => void;
    scheduleTimeout?: (cb: () => void, delayMs: number) => void;
  },
): void {
  if (result.ok) {
    const viaLabel = result.via === 'osc52' ? ' via OSC 52'
      : result.via === 'file' ? ` → ${result.path}`
      : result.via === 'local' ? ''
      : '';
    flashCopiedHud({
      hud: deps.hud,
      draw: deps.draw,
      scheduleTimeout: deps.scheduleTimeout,
      text: C.success(`copied ${deps.lineCount} lines${viaLabel}`),
    });
    if (result.via === 'file' && result.path) {
      deps.pushDebugLine(C.muted(`  📋 payload too large for OSC 52 — saved to ${result.path}`));
    }
    return;
  }

  const hint = result.note === 'ELANOUS_CLIPBOARD_MODE=off'
    ? 'clipboard disabled (ELANOUS_CLIPBOARD_MODE=off)'
    : 'clipboard write failed — install xclip/wl-copy, or set ELANOUS_CLIPBOARD_MODE=osc52';
  deps.pushDebugLine(C.warning(`(${hint})`));
}

function flashCopiedHud(
  deps: {
    hud: DashboardClipboardHud;
    draw: () => void;
    scheduleTimeout?: (cb: () => void, delayMs: number) => void;
    text: string;
  },
): void {
  deps.hud.setCopied(deps.text);
  deps.draw();
  (deps.scheduleTimeout ?? defaultScheduleTimeout)(() => {
    deps.hud.clearCopied();
    deps.draw();
  }, 1500);
}

function defaultScheduleTimeout(cb: () => void, delayMs: number): void {
  setTimeout(cb, delayMs);
}
