/**
 * BACKLOG #15 — TerminalChatDock ↔ TerminalRepl history mirror.
 *
 * REPL strip (sticky 1-row meta-command bar) and the dock (full chat
 * surface) live in the same TerminalPanel and operate on the same
 * terminalId. Without a mirror they accumulate two separate timelines
 * — a user running `:capture` from the strip then a plain agent prompt
 * in the dock sees their flow split across two history views.
 *
 * The dock owns the canonical history. The strip emits a structured
 * mirror event after each `terminal/repl/exec`; the panel forwards it
 * to the dock's imperative `appendMirrored` handle. The mirror is
 * append-only — the strip never edits or replaces a previously mirrored
 * line, so reordering / dedupe lives entirely in the dock surface.
 */

import { newMetaMessage, type ChatMessage } from './chat-runtime';

export type ReplMirrorKind =
  | { kind: 'replCommand'; line: string }
  | { kind: 'replOutput'; output: string }
  | { kind: 'agentResult'; markdown: string; modelLabel: string }
  | { kind: 'note'; text: string }
  // PP-9 (2026-05-07) — daemon-classified system message. Replaces the
  // old xterm-side ANSI echo: `:agent error`, `:capture failed`, etc.
  // now arrive here as `level + text` and render with a styled badge.
  | { kind: 'systemMessage'; level: 'note' | 'error'; text: string };

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Convert a mirror event into a ChatMessage the dock can append. */
export function buildMirroredMessage(event: ReplMirrorKind): ChatMessage {
  switch (event.kind) {
    case 'replCommand':
      return newMetaMessage(`▸ REPL · ${event.line}`);
    case 'replOutput': {
      const plain = stripAnsi(event.output).replace(/\r/g, '').trim();
      return newMetaMessage(plain.length > 0 ? plain : '(no output)');
    }
    case 'agentResult':
      return {
        id: `mirror-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        text: event.markdown,
        timestamp: Date.now(),
        meta: { provider: event.modelLabel, mirrored: 'repl' },
      };
    case 'note':
      return newMetaMessage(event.text);
    case 'systemMessage':
      return {
        id: `mirror-sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'system',
        text: event.text,
        timestamp: Date.now(),
        meta: { mirrored: 'repl', systemLevel: event.level },
      };
  }
}

/** Count attachment entries the dock can't safely forward — daemon's
 *  acp-server normalizer rejects any entry without a `path`. The user
 *  needs an explicit signal so a silent drop doesn't masquerade as a
 *  successful send (audit A in PR #1727). */
export function countDroppedAttachments(
  attached: readonly { path?: string }[],
): number {
  return attached.filter((a) => !(typeof a.path === 'string' && a.path.length > 0)).length;
}
