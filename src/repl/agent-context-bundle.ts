// WT-A-3b — `:agent` context bundler.
//
// Gathers the active web-terminal's visible state (buffer text + cwd +
// cols×rows) and inlines it into the user prompt so the LLM has
// situational context without an extra discovery tool call. Screenshot
// auto-attach is deliberately deferred — the LLM can pull a fresh PNG
// via WebTerminalScreenshot when it actually needs visual fidelity, and
// the daemon-context block (`appendWebtermContext`) already nudges the
// model toward webterm tools when the surface is active.
//
// Why a separate module: keeps `agent-turn.ts` focused on the LLM
// runner and lets tests exercise context gathering with stub
// PreviewTerminal lookups (no daemon boot).

import type { PreviewTerminal } from '../preview/terminal.js';
import { lookupPreviewTerminal } from '../web-terminal/preview-tap-registry.js';

/** Snapshot of the active web terminal at the moment `:agent` was
 *  invoked. All fields are best-effort — when a PreviewTerminal can't
 *  be resolved, an empty string / zero is returned and the prompt
 *  composer drops the corresponding line. */
export interface AgentContext {
  /** Visible buffer text (xterm `buffer.active`), SGR + motion-strip
   *  applied. ~80×24 = ~2KB typical. */
  bufferText: string;
  /** Resolved spawn cwd from PreviewTerminal opts. Empty when unknown. */
  cwd: string;
  cols: number;
  rows: number;
  /** Number of bufferText lines (post-strip). Useful for the prompt
   *  header without recomputing. */
  bufferLines: number;
}

export interface CollectAgentContextOpts {
  /** When set + > 0, restrict the buffer dump to the last N lines of
   *  scrollback (cap on the user-prompt cost). When omitted, every
   *  line `renderForLLM()` returns is included. Phase 3 (#WT-A-3b)
   *  exposes this via the `:agent --scroll N <prompt>` flag for users
   *  who want a tighter or wider window than the default. */
  maxLines?: number;
}

/** Resolve the active terminal's context. Returns an empty bundle when
 *  the terminal can't be found (caller still proceeds — LLM just
 *  doesn't get context-aware prefix). */
export function collectAgentContext(
  sessionId: string,
  terminalId: string,
  /** Test seam — production callers omit. */
  resolver: (sid: string, tid: string) => PreviewTerminal | null = lookupPreviewTerminal,
  opts: CollectAgentContextOpts = {},
): AgentContext {
  const empty: AgentContext = {
    bufferText: '',
    cwd: '',
    cols: 0,
    rows: 0,
    bufferLines: 0,
  };
  if (!sessionId || !terminalId) return empty;
  const pt = resolver(sessionId, terminalId);
  if (!pt) return empty;
  let bufferText = '';
  try {
    bufferText = pt.renderForLLM().trimEnd();
  } catch {
    bufferText = '';
  }
  // Optional scroll-window cap — keep only the trailing N lines so the
  // prompt cost stays predictable when the user passes `--scroll N`.
  // We split + slice + rejoin rather than walking xterm's API directly
  // because `renderForLLM` already handles SGR + motion strip; the cost
  // of one more split is negligible compared to the LLM call itself.
  if (opts.maxLines && opts.maxLines > 0 && bufferText) {
    const lines = bufferText.split('\n');
    if (lines.length > opts.maxLines) {
      bufferText = lines.slice(-opts.maxLines).join('\n');
    }
  }
  const cwd = (pt as unknown as { opts?: { cwd?: string } }).opts?.cwd ?? '';
  return {
    bufferText,
    cwd,
    cols: pt.cols ?? 0,
    rows: pt.rows ?? 0,
    bufferLines: bufferText ? bufferText.split('\n').length : 0,
  };
}

/** Compose the user-text payload sent to `runDaemonPromptTurn`. The
 *  context block is wrapped in fenced markers so the LLM (and any test
 *  asserting the wire shape) can identify it unambiguously, and the
 *  user's prompt sits at the bottom — the closer-to-end position
 *  experiments showed yields stronger instruction-following on most
 *  current models. */
export function formatAgentPrompt(prompt: string, ctx: AgentContext): string {
  const header: string[] = [];
  if (ctx.cwd) header.push(`cwd: ${ctx.cwd}`);
  if (ctx.cols > 0 && ctx.rows > 0) {
    header.push(`size: ${ctx.cols}×${ctx.rows} (${ctx.bufferLines} buffer lines)`);
  }
  const parts: string[] = [];
  if (header.length > 0) {
    parts.push(`<terminal-context>\n${header.join('\n')}\n</terminal-context>`);
  }
  if (ctx.bufferText) {
    parts.push(`<terminal-buffer>\n${ctx.bufferText}\n</terminal-buffer>`);
  }
  parts.push(prompt);
  return parts.join('\n\n');
}
