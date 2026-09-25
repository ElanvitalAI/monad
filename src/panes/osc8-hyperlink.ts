// ── OSC 8 terminal hyperlink primitive ──
//
// Ported from claude-code-fork's `src/ink/render-node-to-output.ts
// :585-591` — modern terminals (iTerm2, kitty, WezTerm, VS Code,
// Windows Terminal) support OSC 8 to make text clickable. The syntax:
//
//     \x1b]8;;URI\x1b\\  text-to-show  \x1b]8;;\x1b\\
//
// Emitting this in terminals that don't support it is SAFE — they
// ignore the OSC sequence and the user sees the plain `text-to-show`.
// We therefore don't gate this behind terminal detection: always-on,
// fall-safe.
//
// Use cases in monad-agent:
//   • File path links in tool-render summaries — click to open.
//   • Error / stack-trace paths in debug log.
//   • Git remote URLs in status bar / blame.

const OSC8_START = '\x1b]8;';
const OSC8_ST = '\x1b\\';

/** Wrap `text` in an OSC 8 hyperlink pointing at `uri`. Optional
 *  `id` correlates multi-line chunks of the same link so terminals
 *  can treat them as one target (see OSC 8 spec). Empty `text` is
 *  returned as-is (prevents emitting an empty link). */
export function osc8Link(text: string, uri: string, id?: string): string {
  if (!text) return text;
  if (!uri) return text;
  const params = id ? `id=${id}` : '';
  return `${OSC8_START}${params};${uri}${OSC8_ST}${text}${OSC8_START};${OSC8_ST}`;
}

/** Convenience: link to a local file using a `file://` URI. On macOS
 *  iTerm2 this opens the file in the default editor; on WezTerm it
 *  drops into the editor too. Callers should pass an ABSOLUTE path. */
export function osc8FileLink(text: string, absolutePath: string): string {
  return osc8Link(text, `file://${absolutePath}`);
}

/** Strip OSC 8 sequences (open + close) from a string. Useful when
 *  writing to a log file that a human will scrollback — the click
 *  semantics don't survive the file boundary anyway. */
export function stripOsc8(s: string): string {
  return s.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}
