// Archon-port T1.1 (2026-05-08) — unified tool allow/deny policy.
//
// Single contract for *every* LLM-call tool roster filter: skill
// runner, REPL, dashboard chat, agent-team, future workflow node.
// Replaces the deny-only `filterToolsByDeny` (which now aliases to
// `applyToolPolicy({ deny })` for back-compat).
//
// Pattern source — Archon `packages/providers/src/types.ts:173`
// NodeConfig.allowed_tools / denied_tools, applied per-call by each
// provider's `applyNodeConfig` (claude/provider.ts:365-380).
//
// Match modes (each entry of allow / deny):
//   - **Exact** name match — `"WebFetch"` matches just WebFetch.
//   - **MCP server prefix** — `"mcp__github"` (no third double-
//     underscore segment) matches every tool whose name starts with
//     `mcp__github__` (whole server).
//   - **MCP single tool** — `"mcp__github__create_issue"` (with
//     server segment) is treated as exact.
//
// Resolution rule: deny wins over allow.
//   policy = { allow: ['Bash', 'Read'], deny: ['Bash'] }
//   → only `Read` survives. (Matches Archon `disallowedTools`
//   semantics — disallow trumps allow when both present.)
//
// `allow: []` is meaningful — explicit empty allow-list yields zero
// tools. Used by Archon's classification nodes (`allowed_tools: []`
// in workflow YAML — see archon-workflow-builder.yaml:67) to force
// the LLM into pure reasoning with no tool side-effects.

import { MCP_WIRE_DELIMITER } from './mcp-wire-name.js';

export interface ToolPolicy {
  /** Whitelist. When defined, only matching tools survive (then
   *  `deny` is applied). `[]` → 0 tools. `undefined` → unrestricted. */
  allow?: readonly string[];
  /** Blacklist. Applied after `allow`. Matching tools are removed. */
  deny?: readonly string[];
}

/** Internal: partition a pattern list into exact names + MCP server prefixes. */
function compilePatterns(patterns: readonly string[]): {
  exact: Set<string>;
  mcpServerPrefixes: string[];
} {
  const exact = new Set<string>();
  const mcpServerPrefixes: string[] = [];
  for (const p of patterns) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const segments = p.split(MCP_WIRE_DELIMITER);
    if (p.startsWith(`mcp${MCP_WIRE_DELIMITER}`) && segments.length === 2) {
      mcpServerPrefixes.push(`${p}${MCP_WIRE_DELIMITER}`);
    } else {
      exact.add(p);
    }
  }
  return { exact, mcpServerPrefixes };
}

/** Check whether a tool name matches any compiled pattern. */
function matchesAny(
  name: string,
  exact: Set<string>,
  mcpServerPrefixes: readonly string[],
): boolean {
  if (exact.has(name)) return true;
  for (const prefix of mcpServerPrefixes) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Filter `tools` against a `ToolPolicy`. Pure: input not mutated.
 * Returns the same array reference when nothing is filtered (so
 * callers can fast-path on `=== tools` if needed).
 *
 * Semantics:
 *   - `policy === undefined` → input unchanged
 *   - `policy.allow === undefined && policy.deny === undefined` → input unchanged
 *   - `policy.allow` defined (even as `[]`) → only matching tools kept
 *   - `policy.deny` matched → tool removed (after allow filter)
 *   - Both defined → allow first, then deny on the survivors
 */
export function applyToolPolicy<T extends { name: string }>(
  tools: T[] | undefined,
  policy: ToolPolicy | undefined,
): T[] | undefined {
  if (!tools || tools.length === 0) return tools;
  if (!policy) return tools;

  const allowDefined = policy.allow !== undefined;
  const denyDefined = policy.deny !== undefined && policy.deny.length > 0;

  if (!allowDefined && !denyDefined) return tools;

  // Compile patterns once. Empty allow ([] when defined) → zero tools.
  if (allowDefined && policy.allow!.length === 0) return [];

  const allow = allowDefined ? compilePatterns(policy.allow!) : null;
  const deny = denyDefined ? compilePatterns(policy.deny!) : null;

  let changed = false;
  const filtered = tools.filter(t => {
    // allow stage
    if (allow) {
      const ok = matchesAny(t.name, allow.exact, allow.mcpServerPrefixes);
      if (!ok) {
        changed = true;
        return false;
      }
    }
    // deny stage (deny wins)
    if (deny) {
      const blocked = matchesAny(t.name, deny.exact, deny.mcpServerPrefixes);
      if (blocked) {
        changed = true;
        return false;
      }
    }
    return true;
  });

  return changed ? filtered : tools;
}

/**
 * Back-compat alias for the pre-T1.1 deny-only helper. Existing call
 * sites (eval-prompt-cli, future migrations) keep working unchanged.
 *
 * Equivalent to `applyToolPolicy(tools, { deny })`.
 */
export function filterToolsByDeny<T extends { name: string }>(
  tools: T[] | undefined,
  denyList: readonly string[] | undefined,
): T[] | undefined {
  return applyToolPolicy(tools, denyList ? { deny: denyList } : undefined);
}
