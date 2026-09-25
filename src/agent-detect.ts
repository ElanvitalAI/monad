// ── Agent Detection (UA1) ──
//
// Inspect a PTY spawn's cmd/args and infer what CLI agent is about
// to run inside it. Used by UA2 (PTY hook) + UA3 (modal spawn hook)
// to stamp TerminalInstance.metadata.agentKind + .character so the
// sidebar, toolbelt, and status parser all light up automatically.
//
// Detection order:
//   1. Manual override  — `--monad-agent-kind=<kind>` in args wins.
//   2. cmd basename     — direct invocation like `claude` / `aider`.
//   3. Wrapper scan     — `bunx @anthropic-ai/claude-code`,
//                         `npx @google/gemini-cli`,
//                         `node /path/to/claude.js` etc.
//   4. Fallback         — `shell`.
//
// Strict prefix / substring matching only; fuzzy is forbidden. If a
// legitimate shell happens to have "claude" in its path the caller
// can use the override to force-correct.

import type { TerminalCharacter } from './terminal-matrix/types.js';
import { isAgentKind, type AgentKind } from './session/card.js';

export interface AgentDetectResult {
  readonly agentKind: AgentKind;
  readonly character: TerminalCharacter;
  /** True when the result came from `--monad-agent-kind=<kind>`,
   *  letting callers log "override" instead of "auto-detected". */
  readonly overridden: boolean;
}

export const AGENT_KIND_OVERRIDE_FLAG = '--monad-agent-kind=';

/** Wrappers that launch a coding agent as a nested command. When the
 *  outer cmd matches one of these, detect() scans the positional
 *  args for the agent's package / script name. */
const WRAPPER_BASES: ReadonlySet<string> = new Set([
  'bunx', 'bun', 'npx', 'pnpm', 'yarn', 'node', 'deno',
  'sh', 'bash', 'zsh', 'fish',
]);

/** Ordered match rules — first hit wins. Patterns test both the raw
 *  arg (catches scoped packages) and its basename-without-extension
 *  (catches `/path/to/claude.js`). */
const PATTERNS: ReadonlyArray<{ kind: AgentKind; re: RegExp }> = [
  { kind: 'claude-code', re: /^claude(-code)?$/i },
  { kind: 'claude-code', re: /@anthropic-ai\/claude-code/i },
  { kind: 'codex',       re: /^codex$/i },
  { kind: 'codex',       re: /@openai\/codex/i },
  { kind: 'gemini-cli',  re: /^gemini(-cli)?$/i },
  { kind: 'gemini-cli',  re: /@google\/gemini-cli/i },
  { kind: 'aider',       re: /^aider$/i },
];

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function stripExt(s: string): string {
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return s;
  const ext = s.slice(dot + 1).toLowerCase();
  if (ext === 'js' || ext === 'ts' || ext === 'mjs' || ext === 'cjs') {
    return s.slice(0, dot);
  }
  return s;
}

function toCharacter(kind: AgentKind): TerminalCharacter {
  switch (kind) {
    case 'claude-code': return { kind: 'claude-code' };
    case 'codex':       return { kind: 'codex' };
    case 'shell':       return { kind: 'shell' };
    default:            return { kind: 'custom', name: kind };
  }
}

function matchToken(token: string): AgentKind | null {
  const base = stripExt(basename(token));
  for (const p of PATTERNS) {
    if (p.re.test(token) || p.re.test(base)) return p.kind;
  }
  return null;
}

/** Variant used by TerminalRegistry.adoptSession (UA2). Inspects an
 *  explicit `character` first (callers that already know what they're
 *  spawning don't need parsing), then falls back to parsing the
 *  `command` string — split on whitespace and feed through
 *  detectAgentKind. `shell` is the last resort. The returned character
 *  is advisory: callers decide whether to upgrade from the default
 *  shell, based on their own intent inference. */
export function detectAgentFromSpec(spec: {
  readonly character?: TerminalCharacter | undefined;
  readonly command?: string | undefined;
}): AgentDetectResult {
  const char = spec.character;
  if (char) {
    if (char.kind === 'claude-code') {
      return { agentKind: 'claude-code', character: char, overridden: false };
    }
    if (char.kind === 'codex') {
      return { agentKind: 'codex', character: char, overridden: false };
    }
    if (char.kind === 'custom' && typeof char.name === 'string' && isAgentKind(char.name)) {
      return { agentKind: char.name, character: char, overridden: false };
    }
  }
  if (typeof spec.command === 'string' && spec.command.trim().length > 0) {
    const parts = spec.command.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      return detectAgentKind(parts[0]!, parts.slice(1));
    }
  }
  return {
    agentKind: 'shell',
    character: char ?? { kind: 'shell' },
    overridden: false,
  };
}

export function detectAgentKind(cmd: string, args: readonly string[] = []): AgentDetectResult {
  for (const a of args) {
    if (typeof a !== 'string') continue;
    if (a.startsWith(AGENT_KIND_OVERRIDE_FLAG)) {
      const v = a.slice(AGENT_KIND_OVERRIDE_FLAG.length);
      if (isAgentKind(v)) {
        return { agentKind: v, character: toCharacter(v), overridden: true };
      }
    }
  }

  const cmdBase = stripExt(basename(cmd ?? ''));

  const direct = matchToken(cmdBase);
  if (direct) return { agentKind: direct, character: toCharacter(direct), overridden: false };

  if (WRAPPER_BASES.has(cmdBase.toLowerCase())) {
    for (const a of args) {
      if (typeof a !== 'string' || a.length === 0) continue;
      if (a.startsWith('-')) continue;
      const hit = matchToken(a);
      if (hit) return { agentKind: hit, character: toCharacter(hit), overridden: false };
    }
  }

  return { agentKind: 'shell', character: { kind: 'shell' }, overridden: false };
}
