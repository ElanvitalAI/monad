// T-1 — capability-response filter for xterm.js → ACP wire.
//
// PreviewTerminal (server-side xterm-headless in src/preview/terminal.ts:290)
// already writes capability responses back to the PTY master fd with
// microsecond latency — that's the load-bearing path for yazi/fzf/tmux/htop
// DA queries, cursor-position queries (DSR), and OSC color/title queries.
//
// The PWA's browser-side xterm.js *also* emits the same responses on
// `term.onData`. If we forward those over ACP/WebSocket, the round-trip
// (~100-200ms) lands the response at the PTY long after zsh has finished
// prompt-draw and entered stdin-read. zsh then echoes the raw bytes
// (`^[[?62;4;9;22c…`) on the prompt line and tmux's `new -s` is corrupted
// because half its argv is escape garbage — exactly the symptom in the
// 2026-05-07 dogfood screenshot.
//
// Fix: the browser-side response is redundant — server already handled it.
// Drop it at the source.
//
// User keystrokes that *also* start with ESC (arrow keys, F-keys, alt
// chords, bracketed-paste markers) must NOT be swallowed. The filter
// matches only the four response shapes emitted by xterm.js's input
// handler in reply to PTY-initiated queries — DA/DECRPM, DSR cursor pos,
// DSR status, OSC reply, XTWINOPS reply. Everything else falls through.
//
// References:
//   - xterm-js source: addons/addon-* not relevant; core
//     `_inputHandler.requestStatusString` & `_coreService.triggerDataEvent`
//   - VT100 manual: DA, DSR; DEC STD 070
//   - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html

const PRIMARY_OR_PRIVATE_DA_RE = /^\x1b\[[?>=][\d;]*[a-zA-Z$]/;
const DSR_CURSOR_POS_RE = /^\x1b\[\d+;\d+R$/;
const DSR_STATUS_OK_RE = /^\x1b\[0?n$/;
const OSC_REPLY_RE = /^\x1b\][\d;]+;[^\x07\x1b]*(?:\x07|\x1b\\)$/;
const XTWINOPS_REPLY_RE = /^\x1b\[\d+;\d+;\d+t$/;

/**
 * True if `data` looks like a capability response that the browser-side
 * xterm.js emitted in reply to a PTY query — never a user keystroke.
 */
export function isXtermCapabilityResponse(data: string): boolean {
  if (!data || data.length < 2) return false;
  if (data.charCodeAt(0) !== 0x1b) return false;
  if (PRIMARY_OR_PRIVATE_DA_RE.test(data)) return true;
  if (DSR_CURSOR_POS_RE.test(data)) return true;
  if (DSR_STATUS_OK_RE.test(data)) return true;
  if (OSC_REPLY_RE.test(data)) return true;
  if (XTWINOPS_REPLY_RE.test(data)) return true;
  return false;
}
