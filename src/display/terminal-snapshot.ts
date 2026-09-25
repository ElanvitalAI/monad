// Terminal snapshot helpers.
//
// Capture the current grid of a PreviewTerminal / ExecutionSurface
// as a TerminalRenderFrame. Non-interactive and cheap: just calls
// render(false) and splits on newlines. The live PTY ownership
// stays where it was — the snapshot is a detached copy.
//
// Uses:
//   • /term snapshot slash → pin current preview terminal's screen
//     into the scratch pane (§8.9 recording/replay groundwork)
//   • plugin tools that want to publish "current screen of X"
//   • debug/history drawer for time-travel (future)

import type { PreviewTerminal } from '../preview/terminal.js';
import type { ExecutionSurfaceHandle } from './execution-surface.js';
import type { TerminalRenderFrame } from './terminal-frame.js';

export interface CaptureOpts {
  title?: string;
  /** Hint for renderers that place this frame. */
  preferredCols?: number;
  preferredRows?: number;
}

/** Snapshot a PreviewTerminal's current grid. Non-interactive; the
 *  PTY keeps running, this just reads render() output. */
export function capturePreviewTerminalFrame(
  pt: PreviewTerminal,
  opts: CaptureOpts = {},
): TerminalRenderFrame {
  const rendered = pt.render(false);
  return {
    title: opts.title,
    lines: rendered.split('\n'),
    preformatted: true,
    preferredCols: opts.preferredCols,
    preferredRows: opts.preferredRows,
    source: 'snapshot',
  };
}

/** Snapshot an ExecutionSurfaceHandle's grid. Uses the handle's
 *  ExecutionTerminal.render() directly — no RenderCtx / resize
 *  side-effect. Caller's sizing is irrelevant for snapshots. */
export function captureExecutionFrame(
  handle: ExecutionSurfaceHandle,
  opts: CaptureOpts = {},
): TerminalRenderFrame {
  const rendered = handle.terminal.render(false);
  return {
    title: opts.title,
    lines: rendered.split('\n'),
    preformatted: true,
    preferredCols: opts.preferredCols,
    preferredRows: opts.preferredRows,
    source: 'snapshot',
  };
}
