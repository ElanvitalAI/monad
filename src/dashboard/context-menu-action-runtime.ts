import type { BrowserBodyMenuPayload } from '../browser-context-menu.js';
import type { ScratchMenuPayload } from '../scratch-context-menu.js';
import {
  buildDashboardScratchCopyPayload,
  buildDashboardScratchExportPayload,
} from './clipboard-message-runtime.js';

export interface DashboardContextMenuActionRuntimeDeps {
  info: (text: string) => string;
  warning: (text: string) => string;
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
  draw: () => void;
}

export function reportDashboardBrowserOpenAction(
  deps: DashboardContextMenuActionRuntimeDeps,
  payload: BrowserBodyMenuPayload,
): void {
  const verb = payload.isDir ? 'enter dir' : 'preview';
  deps.pushChatLine(deps.info(`  [ctx-menu] ${verb}: ${payload.absPath} (action TBD)`));
  deps.setChatScrollBottom();
  deps.draw();
}

export function reportDashboardBrowserRevealResult(
  deps: DashboardContextMenuActionRuntimeDeps,
  payload: BrowserBodyMenuPayload,
  ok: boolean,
): void {
  deps.pushChatLine(
    ok
      ? deps.info(`  revealed in Finder: ${payload.absPath}`)
      : deps.warning('  reveal failed (non-macOS host?)'),
  );
  deps.setChatScrollBottom();
  deps.draw();
}

export function runDashboardScratchClearAction(
  deps: DashboardContextMenuActionRuntimeDeps,
  payload: ScratchMenuPayload | undefined,
  currentLineCount: number,
): string[] {
  const prior = payload?.lineCount ?? currentLineCount;
  deps.pushChatLine(deps.info(`  [ctx-menu] scratch cleared (${prior} lines)`));
  deps.setChatScrollBottom();
  deps.draw();
  return [];
}

export async function runDashboardScratchCopyAllAction(
  deps: DashboardContextMenuActionRuntimeDeps,
  payload: ScratchMenuPayload | undefined,
  scratchLines: string[],
  writeClipboard: (text: string) => Promise<boolean>,
): Promise<void> {
  try {
    const text = buildDashboardScratchCopyPayload(scratchLines);
    const ok = await writeClipboard(text);
    deps.pushChatLine(
      ok
        ? deps.info(`  copied scratch: ${payload?.lineCount ?? scratchLines.length} lines · ${payload?.totalBytes ?? text.length} bytes`)
        : deps.warning('  clipboard write failed (no compatible backend)'),
    );
    deps.setChatScrollBottom();
    deps.draw();
  } catch {
    // keep prior silent-failure behavior
  }
}

export async function runDashboardScratchExportAction(
  deps: DashboardContextMenuActionRuntimeDeps,
  scratchLines: string[],
  writeTempFile: (text: string) => Promise<string>,
): Promise<void> {
  try {
    const dest = await writeTempFile(buildDashboardScratchExportPayload(scratchLines));
    deps.pushChatLine(deps.info(`  exported scratch → ${dest}`));
  } catch (error) {
    deps.pushChatLine(
      deps.warning(`  scratch export failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
  deps.setChatScrollBottom();
  deps.draw();
}
