// Daemon system-prompt context for the webterm tool surface.
//
// Origin: image content pipeline followups #1 (sessionId LLM args 자동
// 주입) + #4 (system prompt 에 webterm context 안내), 2026-05-05.
//
// Problem: WebTerminal* tool specs require `sessionId` in their input
// schema, but the LLM has no out-of-band way to know which ACP session
// this turn belongs to. When the operator's prompt doesn't spell it
// out, the model invents a placeholder ("default") and gets back an
// empty list — dogfood friction we can erase by injecting the daemon's
// view of "current sessionId + active terminals" into the system
// prompt only when the webterm surface is actually active.
//
// Why a helper instead of inline: both `daemon-prompt-turn.ts` (REST
// `/v1/prompt`) and `daemon-runtime.ts` (ACP WebSocket path) compose
// system prompts before each turn. Sharing one composer keeps the
// two paths from drifting and makes the kind='webterm' logic
// testable in isolation.

import type { DaemonToolSurface } from './types.js';
import {
  listPreviewTerminals,
  type PreviewTerminalListEntry,
} from '../../web-terminal/preview-tap-registry.js';

/** Build a one-block summary of the daemon's per-turn tool context.
 *
 *  Returns null when there's nothing relevant to inject:
 *    - `toolSurface` is undefined or kind === 'none'  → no tools, no help.
 *    - `toolSurface.kind === 'readonly'` → Read · Grep · WebSearch don't
 *      consume sessionId, so the block would be noise.
 *
 *  When kind === 'webterm':
 *    - Always emit `Current ACP sessionId: <id>` so the LLM has the
 *      exact value to thread into WebTerminal* args.
 *    - Enumerate active terminals via `listPreviewTerminals(sessionId)`
 *      so the model can skip a probing WebTerminalList call when one
 *      already exists. (~70 LOC walker, free for the daemon.)
 *    - Add a single "use the sessionId above" reminder so models that
 *      ignore JSON schema descriptions still fall into the right slot. */
export function composeWebtermSystemContext(
  sessionId: string,
  toolSurface?: DaemonToolSurface,
  /** Override for the registry walker — tests inject a stub so we can
   *  exercise the formatter without touching the real preview-tap
   *  registry. Default delegates to the production lookup. */
  lookup: (id: string) => PreviewTerminalListEntry[] = listPreviewTerminals,
): string | null {
  if (!sessionId) return null;
  if (!toolSurface || toolSurface.kind !== 'webterm') return null;
  const lines: string[] = [`Current ACP sessionId: ${sessionId}`];
  const terminals = lookup(sessionId);
  if (terminals.length === 0) {
    // 2026-05-13 chat-friction-free — do NOT instruct the LLM to "ask
    // the user to open a terminal". Most missions (cwd · ls · grep ·
    // file edits) are served by the daemon-side file tools, which do
    // not need a PTY session. Reserve web-terminal escalation for
    // genuinely interactive workflows (REPL · long-running watchers ·
    // TUI apps) and let the model fall through to Read / Grep / Edit
    // by default.
    lines.push('Active web terminals: (none yet)');
    lines.push(
      'No PTY session is required for filesystem queries. '
      + 'Use Read / Grep / Edit (and Bash / RunShell when those become available) — '
      + 'they execute against the daemon tool-cwd directly. '
      + 'Only request the user to open a web terminal for genuinely interactive workflows '
      + '(REPL, vim, long-running watchers, TUI apps).',
    );
  } else {
    const summary = terminals
      .map((t) => `${t.terminalId} (${t.cols}×${t.rows}, ${t.isAlive ? 'alive' : 'dead'})`)
      .join(', ');
    lines.push(`Active web terminals: ${summary}`);
    lines.push(
      'WebTerminal* tools auto-resolve sessionId — omit it from args. '
      + 'Pass terminalId from the list above (no need to call WebTerminalList first).',
    );
  }
  return lines.join('\n');
}

/** Append `composeWebtermSystemContext(...)` to an existing system
 *  prompt with a blank-line separator. Returns the original prompt
 *  unchanged when there's nothing to add. */
export function appendWebtermContext(
  basePrompt: string | undefined,
  sessionId: string,
  toolSurface?: DaemonToolSurface,
  lookup?: (id: string) => PreviewTerminalListEntry[],
): string | undefined {
  const block = composeWebtermSystemContext(sessionId, toolSurface, lookup);
  if (!block) return basePrompt;
  if (!basePrompt || basePrompt.trim().length === 0) return block;
  return `${basePrompt}\n\n${block}`;
}
