// @term:<id> prompt expansion.
//
// Pure text-substitution helper: scans a chat input string for
// `@term:<id>` tokens and replaces each with a structured snapshot
// block drawn from the TerminalSessionRegistry. The LLM sees the
// session's last N bytes of output in context so it can answer
// questions like "what's this claude-code session stuck on?"
// without a separate TerminalModalObserve tool call.
//
// Token syntax:
//
//   @term:<id>          — last TAIL_BYTES of session snapshot
//   @term:<id>#all      — full snapshot (unsliced)
//   @term:<id>#<N>      — last <N> bytes (decimal)
//
// `#` was chosen as the modifier separator because session ids
// themselves contain `:` (e.g. `term-session:1`) — reusing `:` for
// the mode suffix made the regex ambiguous.
//
// <id> can be the full session id OR its trailing hex suffix
// (matches endsWith). First registry entry whose id ends with the
// suffix wins — same lenient matching as the /term attach slash.
//
// Expansion output:
//
//   <terminal-session id="..." title="..." cwd="..." state="...">
//   <last-N>
//   …snapshot bytes…
//   </last-N>
//   </terminal-session>
//
// If no session matches the token, the token is left untouched so
// the user can tell (and LLM can report the bad id back).

import type { TerminalSessionRegistry, TerminalSession } from '../terminal/session-registry.js';

const DEFAULT_TAIL_BYTES = 4 * 1024;

const TOKEN_RE = /@term:([A-Za-z0-9:_-]+?)(?:#(\d+|all))?(?=\s|$|[.,!?;)])/g;

export interface ExpandOpts {
  /** Default tail size when the token doesn't specify one. */
  defaultTailBytes?: number;
  /** Override render fn (test seam). */
  snapshot?: (s: TerminalSession) => string;
}

export function expandTerminalReferences(
  input: string,
  registry: TerminalSessionRegistry,
  opts: ExpandOpts = {},
): string {
  const defaultTail = opts.defaultTailBytes ?? DEFAULT_TAIL_BYTES;
  const snap = opts.snapshot ?? ((s) => {
    try { return s.preview.render(false); } catch { return ''; }
  });

  return input.replace(TOKEN_RE, (match, id: string, byteSpec: string | undefined) => {
    const session = findSession(registry, id);
    if (!session) return match;
    let rendered = snap(session);

    let label: string;
    if (byteSpec === 'all') {
      label = 'full';
    } else {
      const tailBytes = byteSpec ? Math.max(1, parseInt(byteSpec, 10)) : defaultTail;
      if (rendered.length > tailBytes) {
        rendered = rendered.slice(-tailBytes);
        label = `last-${tailBytes}`;
      } else {
        label = `full-${rendered.length}`;
      }
    }

    const brand = session.agentBrand ? ` brand="${session.agentBrand}"` : '';
    return (
      `<terminal-session id="${session.id}" title="${escapeAttr(session.title)}" ` +
      `cwd="${escapeAttr(session.cwd)}" state="${session.state}"${brand}>\n` +
      `<${label}>\n${rendered}\n</${label}>\n` +
      `</terminal-session>`
    );
  });
}

function findSession(registry: TerminalSessionRegistry, idOrSuffix: string): TerminalSession | null {
  const exact = registry.get(idOrSuffix);
  if (exact) return exact;
  const cand = registry.list().filter(s => s.id.endsWith(idOrSuffix));
  if (cand.length === 0) return null;
  // Prefer foreground, then most-recently focused.
  cand.sort((a, b) => {
    if (a.state === 'foreground' && b.state !== 'foreground') return -1;
    if (b.state === 'foreground' && a.state !== 'foreground') return 1;
    return b.lastFocusedAt - a.lastFocusedAt;
  });
  return cand[0]!;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
