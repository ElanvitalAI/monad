// Hermes-ACP lessons §5 — ACP stdio discipline static lint.
//
// Motivation: when `elanous --acp-server` is running over stdio (the
// default), stdout is reserved for JSON-RPC frames. A single stray
// `console.log(...)` on the server-side path corrupts the stream and
// the parent client (claude-code, zed, …) drops the connection.
// Hermes solves this by forcing every print / log in
// `acp_adapter/*` to stderr (`acp_adapter/entry.py:21-35`,
// `session.py:22-30`). We can't hijack Node's globals the same way,
// but we CAN scan the server-side module graph for calls that
// would land on stdout and fail the build if any are reachable.
//
// Offending call shapes (stdout-bound):
//   - console.log / console.info / console.warn / console.debug
//   - process.stdout.write
//   - process.stdout.cork / uncork (signals direct stdout usage)
//
// Allowed (stderr-bound):
//   - console.error (maps to stderr in Node/Bun)
//   - process.stderr.write
//   - debug.log(...) (internal logger routes to log/debug-*.log,
//     never to stdio in normal mode)
//
// The scan is intentionally a regex over literal source — missing
// an obfuscated call (`const c = console; c.log('x')`) is fine;
// nobody writes that in the ACP path, and a false negative on
// pathological code costs less than a false positive blocking a
// legitimate refactor. A future AST-based version can tighten.

const STDOUT_CALL_PATTERNS: readonly RegExp[] = [
  /\bconsole\.(log|info|warn|debug)\s*\(/g,
  /\bprocess\.stdout\.(write|cork|uncork)\s*\(/g,
];

export interface StdioDisciplineHit {
  /** Source text of the matched call, up to the opening paren. */
  match: string;
  /** 0-based char offset into the source. */
  offset: number;
  /** 1-based line number. */
  line: number;
}

/** Scan a single module source for stdout-bound calls. Returns every
 *  hit so callers can report all offenders in one test run, not just
 *  the first. */
export function scanAcpStdioDiscipline(source: string): StdioDisciplineHit[] {
  const hits: StdioDisciplineHit[] = [];
  for (const pattern of STDOUT_CALL_PATTERNS) {
    // Reset lastIndex so repeated scans across patterns don't skip.
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(source)) !== null) {
      const offset = m.index;
      // Line number = newlines before offset + 1. Computed lazily —
      // guard test only reports the first failure per module in
      // practice, so the cost is negligible.
      let line = 1;
      for (let i = 0; i < offset; i += 1) {
        if (source.charCodeAt(i) === 10) line += 1;
      }
      hits.push({ match: m[0], offset, line });
    }
  }
  // Dedup + sort by offset so the report is deterministic. Same
  // offset can match two patterns when a future revision overlaps
  // them — pick the first-defined pattern's match.
  const seen = new Set<number>();
  return hits
    .filter((h) => {
      if (seen.has(h.offset)) return false;
      seen.add(h.offset);
      return true;
    })
    .sort((a, b) => a.offset - b.offset);
}

/** Canonical list of modules the guard test scans. Kept here so the
 *  test's `DESCRIPTION` and the production allowlist stay in sync.
 *  When a new ACP server-side module lands, add it here. */
export const ACP_STDIO_DISCIPLINE_MODULES: readonly string[] = [
  // Core ACP server surface.
  'src/acp/server.ts',
  'src/acp/core-turn-bridge.ts',
  'src/acp/capabilities.ts',
  'src/acp/elanous-extensions.ts',
  'src/acp/dual-role-manager.ts',
  'src/acp/session-persistence.ts',
  // Boot path invoked from `elanous --acp-server`.
  'src/boot/acp-server.ts',
  // Core-turn adapter — reached via bridgeCoreTurnToAcp.
  'src/core-turn/run-core-turn.ts',
  'src/core-turn/types.ts',
  'src/core-turn/index.ts',
  // TUI-client scaffold — used by DashboardSession boot.
  'src/tui-client/acp-transport-local.ts',
  'src/tui-client/in-process-transport.ts',
  'src/tui-client/dashboard-session.ts',
  'src/tui-client/elanous-ui-handler.ts',
  'src/tui-client/headless-core-guard.ts',
  'src/tui-client/index.ts',
];
