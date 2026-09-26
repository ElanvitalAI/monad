// Phase 1 · Channel Terminal Relay — pure formatter.
//
// 내부 문서 `PLAN-channel-terminal-relay-2026-07-09` §A (P1.1 keystone).
//
// PROBLEM: when a coding agent (claude-code / codex / gemini) is driven
// from a chat channel (Telegram `/cc`, NL delegate), its tool calls —
// the shell commands it runs, the diffs it applies, the errors it hits —
// are stripped before reaching the chat. `runAcpTurn` renders only a
// bare `→ tool: Bash` marker (src/acp/turn-runner.ts) and
// `extractUpdateText` (src/skills/tools/acp-session.ts) returns '' for
// every non-message update. The user sees prose ("tests pass") but never
// the actual command, its stdout/stderr, the applied diff, or a stack
// trace on failure.
//
// THIS MODULE is the channel-agnostic seam that turns an ACP
// `session/update` (tool_call · tool_call_update) into a chat-renderable
// markdown snippet — command in, output/diff out — with verbosity
// filtering and an overflow signal for file-spill. It is PURE (no I/O,
// no async, no sink dependency): callers (turn-runner today; the Telegram
// / Discord sinks in later phases) feed it updates and decide how to
// deliver the returned text.
//
// Reference · the ACP tool-call lifecycle it consumes is normalized by
// src/acp/tool-call-state.ts (rawInput = {command,cwd}|{changes},
// rawOutput = result|error). Reference · Warp block-based terminal
// output + status glyphs (docs.warp.dev) — same per-state glyph vocab as
// `toolCallGlyph` there.

/** The subset of an ACP `session/update` this relay consumes. Loosely
 *  typed on purpose — the wire shape varies per backend (codex
 *  app-server vs claude-code-acp vs gemini) and we defensively probe a
 *  handful of common fields. */
export interface RelayToolUpdate {
  sessionUpdate: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
}

// Verbosity levels remain in the formatter (renderToolUpdate) for future
// use (e.g. P1.4 verbose + file spill), but there is NO user knob — the
// relay path hardcodes 'normal'. De-optioned as premature configurability.
export type RelayVerbosity = 'quiet' | 'normal' | 'verbose';

export interface RenderToolOpts {
  /** quiet = mutating tools only, output on failure only. normal
   *  (default) = mutating tools show command + output, read-only tools
   *  show a 1-line header. verbose = everything, full output. */
  verbosity?: RelayVerbosity;
  /** Max chars of tool output rendered inline before truncation +
   *  overflow signal. Default 1400 (Telegram-message-friendly). */
  maxInline?: number;
}

export interface RelayRender {
  /** Markdown snippet to append to the chat transcript. Always ends
   *  with a newline so consecutive appends stay separated. */
  text: string;
  /** Present when the tool output exceeded `maxInline`: the FULL body,
   *  so a sink with file support (Telegram sendDocument / Discord
   *  attachment) can spill it. `ext` hints the file extension, `title`
   *  the tool label (for the attachment caption). Inline `text` already
   *  carries a truncated head + a "(truncated)" note. */
  overflow?: { body: string; ext: string; title: string };
}

// ── Relay truncation policy — the single source (item 4). Two levels,
// deliberately distinct because they bound different things:
//
//  • RELAY_INLINE_CAP — per chat MESSAGE. How much tool output renders
//    inline before we truncate the head and spill the full body as a
//    file (P1.4). Telegram-message-friendly.
//  • DELEGATE_AGGREGATE_CAP — the NL `delegate_code_agent` tool RESULT
//    returned to elanous's LLM. Bounds the model's context, NOT the chat.
//    The full per-tool bodies still reach the user via the file spill;
//    this only clips what the orchestrating LLM re-reads.
//
// They are NOT redundant (one is a display cap, one a context cap) — but
// they now live together so the policy is legible in one place instead of
// scattered as magic numbers across the two delegate paths.
export const RELAY_INLINE_CAP = 1400;
export const DELEGATE_AGGREGATE_CAP = 8000;

const DEFAULT_MAX_INLINE = RELAY_INLINE_CAP;

/** Wire status → glyph. Mirrors `toolCallGlyph` in
 *  src/acp/tool-call-state.ts (kept local so this module stays
 *  self-contained and integrates without a cross-import). */
function statusGlyph(status: string | undefined): string {
  switch (status) {
    case 'in_progress': return '⟳';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'pending':
    case undefined:
    case null as unknown as string:
      return '⋯';
    default: return '⟳';
  }
}

/** ACP `ToolKind` classification. Mutating tools (the ones whose output
 *  a user actually needs to see) vs read-only. Falls back to a title
 *  heuristic when `kind` is absent (some backends omit it). */
export function isMutatingTool(kind: string | undefined, title: string | undefined): boolean {
  if (kind) {
    // ToolKind union: read | edit | delete | move | search | execute |
    // think | fetch | other.
    if (kind === 'edit' || kind === 'delete' || kind === 'move' || kind === 'execute') return true;
    if (kind === 'read' || kind === 'search' || kind === 'fetch' || kind === 'think') return false;
  }
  const t = (title ?? '').toLowerCase();
  if (/\b(read|grep|glob|list|search|find|view|cat|ls)\b/.test(t)) return false;
  if (/\b(bash|shell|exec|run|edit|write|apply|patch|npm|yarn|pnpm|bun|git|test|build|rm|mv|mkdir)\b/.test(t)) return true;
  // Unknown → treat as mutating so we never silently hide a real action.
  return true;
}

/** Pull a runnable command string out of an ACP `rawInput`. Handles the
 *  common shapes: `{command}` (string or argv array · codex exec,
 *  claude Bash), `{cmd}`, and returns undefined when there's no command
 *  (e.g. a file-edit tool — its content shows up as a diff instead). */
export function extractToolCommand(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== 'object') return undefined;
  const r = rawInput as Record<string, unknown>;
  const cmd = r.command ?? r.cmd;
  if (typeof cmd === 'string' && cmd.trim()) return cmd.trim();
  if (Array.isArray(cmd) && cmd.every((x) => typeof x === 'string')) {
    const joined = (cmd as string[]).join(' ').trim();
    return joined || undefined;
  }
  return undefined;
}

/** Normalize an ACP `rawOutput` (or the output half of a rawInput) into
 *  displayable text. Probes the common fields agents use, then falls
 *  back to a compact JSON dump. Returns undefined when there's nothing
 *  meaningful to show. */
export function extractToolText(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const field of ['output', 'stdout', 'content', 'text', 'result', 'stderr', 'error', 'message']) {
      const v = r[field];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    try {
      const json = JSON.stringify(raw);
      if (json && json !== '{}' && json !== '[]') return json;
    } catch {
      /* circular / unserializable — nothing to show */
    }
  }
  return undefined;
}

/** True when the rawInput describes a file edit (so the output should be
 *  fenced as a `diff` rather than plain shell output). */
function looksLikeDiff(text: string): boolean {
  return /^(@@ |diff --git |--- |\+\+\+ |[+-])/m.test(text) && /\n[+-]/.test(text);
}

function truncate(body: string, maxInline: number): { head: string; overflowed: boolean } {
  if (body.length <= maxInline) return { head: body, overflowed: false };
  return { head: body.slice(0, maxInline), overflowed: true };
}

function fence(body: string, lang = ''): string {
  // Guard against a body that itself contains a closing fence.
  const safe = body.replace(/```/g, '`​``');
  return '```' + lang + '\n' + safe + '\n```\n';
}

/** Render a single ACP tool update into a chat markdown snippet.
 *
 *  Dedup contract (the caller relies on this): a command is rendered
 *  ONLY on the `tool_call` event; output/diff ONLY on `tool_call_update`.
 *  Feed every update through — this returns null when there's nothing to
 *  show (read-only tool filtered by verbosity, in-progress update with
 *  no new output, etc.). */
export function renderToolUpdate(u: RelayToolUpdate, opts: RenderToolOpts = {}): RelayRender | null {
  const verbosity: RelayVerbosity = opts.verbosity ?? 'normal';
  const maxInline = opts.maxInline ?? DEFAULT_MAX_INLINE;
  const title = u.title ?? u.kind ?? 'tool';
  const mutating = isMutatingTool(u.kind, u.title);

  // quiet: hide read-only tools entirely.
  if (verbosity === 'quiet' && !mutating) return null;

  if (u.sessionUpdate === 'tool_call') {
    const glyph = statusGlyph(u.status);
    // read-only tool at 'normal' → compact 1-line header, no command body.
    if (!mutating && verbosity === 'normal') {
      return { text: `\n_${glyph} ${title}_\n` };
    }
    const command = extractToolCommand(u.rawInput);
    let text = `\n**${glyph} ${title}**\n`;
    if (command) text += fence(command, 'bash');
    return { text };
  }

  if (u.sessionUpdate === 'tool_call_update') {
    const status = u.status;
    const failed = status === 'failed';
    const glyph = statusGlyph(status);
    // quiet: only surface output on failure.
    if (verbosity === 'quiet' && !failed) return null;
    // read-only tool output is noise at normal — only show on failure.
    if (!mutating && verbosity !== 'verbose' && !failed) return null;

    const body = extractToolText(u.rawOutput);
    if (!body) {
      // Terminal transition with no output → a status line only when it
      // adds signal (failure, or verbose mode).
      if (failed) return { text: `\n_${glyph} ${title} failed_\n` };
      return null;
    }

    const isDiff = looksLikeDiff(body);
    const { head, overflowed } = truncate(body, maxInline);
    let text = `\n_${glyph} ${title}_\n`;
    text += fence(head + (overflowed ? `\n… (truncated ${body.length - head.length} chars)` : ''), isDiff ? 'diff' : '');
    const render: RelayRender = { text };
    if (overflowed) render.overflow = { body, ext: isDiff ? 'diff' : 'txt', title };
    return render;
  }

  return null;
}
