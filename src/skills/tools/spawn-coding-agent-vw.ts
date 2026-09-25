// Native tool: SpawnCodingAgentInVW — T6-K6.
//
// One-call convenience to spawn claude-code / codex inside a
// fresh virtual window with a terminal pane. The LLM in dashboard-
// control mode uses this to create a dedicated workspace for an
// external coding agent + then chat with it via `@pane:<id>` for
// bidirectional context transfer.
//
// Unlike the existing spawnCodingAgent (which targets the single-
// modal TerminalSessionRegistry), this lands inside the VW stack so:
//
//   • user can split the VW to get the agent + a notes pane side-
//     by-side
//   • @pane:<id> prompt expansion inlines the agent's latest
//     output in the next Monad chat turn
//   • PaneInject (approval-gated) feeds user messages back in
//   • multiple agents can run in multiple VWs simultaneously
//
// This is our "official ACP-like path" pending a real JSON-RPC
// ACP client (Tier 7+).

import { spawnSync } from 'node:child_process';
import type { LLMToolSpec } from '../../llm.js';
import { getSessionCwd } from '../../session/working-dir.js';
import type { WindowRegistry } from '../../virtual-windows/window-registry.js';
import type { PaneFactoryDeps, PaneContentSpec } from '../../virtual-windows/pane-content.js';
import { CodingAgentBinaryMissing } from '../../terminal/coding-agent.js';
import { wrapCommandForKeychainUnlock } from '../../terminal/keychain-unlock.js';

export type CodingAgentBrand = 'claude-code' | 'codex';

function binaryForBrand(brand: CodingAgentBrand): string {
  return brand === 'claude-code' ? 'claude' : 'codex';
}

function defaultWhich(binary: string): string | null {
  const r = spawnSync('which', [binary], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1500 });
  if (r.status !== 0) return null;
  const path = r.stdout?.toString().trim();
  return path || null;
}

export interface SpawnCodingAgentInVWOpts {
  brand: CodingAgentBrand;
  cwd?: string;
  extraArgs?: readonly string[];
  /** Override title. Defaults to `<brand> [<basename(cwd)>]`. */
  title?: string;
}

export interface SpawnCodingAgentInVWDeps {
  registry?: WindowRegistry;
  paneDeps?: PaneFactoryDeps;
  /** Test seam for `which`. Override to skip the binary probe. */
  whichBinary?: (name: string) => string | null;
  /** Test seam — overrides the SSH/macOS keychain-unlock command
   *  wrap. Default uses real env detection. */
  wrapCommand?: (cmd: string) => string;
}

let _registry: WindowRegistry | null = null;
let _paneDeps: PaneFactoryDeps = {};

export function initSpawnCodingAgentInVW(
  registry: WindowRegistry,
  paneDeps: PaneFactoryDeps = {},
): void {
  _registry = registry;
  _paneDeps = paneDeps;
}

export function _resetSpawnCodingAgentInVWForTesting(): void {
  _registry = null;
  _paneDeps = {};
}

function basenameSafe(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p ?? 'cwd';
}

export function buildSpawnCodingAgentInVWTool(): LLMToolSpec {
  return {
    name: 'SpawnCodingAgentInVW',
    description:
      'Spawn claude-code or codex inside a new virtual window with a terminal pane. Returns window_id + pane_id so the caller can observe output (via PaneCapture / @pane:<id>) and inject user messages (via PaneInject, approval-gated). Fails with a clear error when the binary isn\'t on PATH.',
    parameters: {
      type: 'object',
      properties: {
        brand: {
          type: 'string',
          enum: ['claude-code', 'codex'],
          description: 'Which coding agent to spawn.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the agent. Defaults to the session working directory (getSessionCwd()).',
        },
        extra_args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional CLI args passed after the binary name.',
        },
        title: {
          type: 'string',
          description: 'Override the window title. Default: `<brand> [<cwd-basename>]`.',
        },
      },
      required: ['brand'],
      additionalProperties: false,
    },
  };
}

export async function dispatchSpawnCodingAgentInVW(
  rawArgs: Record<string, unknown>,
  deps: SpawnCodingAgentInVWDeps = {},
): Promise<{ output: string; windowId: number; paneId: string; brand: CodingAgentBrand }> {
  const registry = deps.registry ?? _registry;
  if (!registry) {
    throw new Error('SpawnCodingAgentInVW not wired — call initSpawnCodingAgentInVW first.');
  }
  const paneDeps = deps.paneDeps ?? _paneDeps;
  const brandRaw = String(rawArgs.brand ?? '').trim();
  if (brandRaw !== 'claude-code' && brandRaw !== 'codex') {
    throw new Error(`'brand' must be 'claude-code' or 'codex'`);
  }
  const brand = brandRaw as CodingAgentBrand;
  // WD6 — default spawn cwd to the session working directory.
  const cwd = typeof rawArgs.cwd === 'string' && rawArgs.cwd.trim() ? rawArgs.cwd.trim() : getSessionCwd();
  const extraArgs = Array.isArray(rawArgs.extra_args)
    ? rawArgs.extra_args.map(String)
    : [];

  const binary = binaryForBrand(brand);
  const which = deps.whichBinary ?? defaultWhich;
  if (which(binary) === null) {
    throw new CodingAgentBinaryMissing(binary);
  }

  const title = typeof rawArgs.title === 'string' && rawArgs.title.trim()
    ? rawArgs.title.trim()
    : `${brand} [${basenameSafe(cwd)}]`;

  const rawCmd = [binary, ...extraArgs].join(' ');
  // Only `claude` reads the macOS keychain — codex does not. Gate
  // the SSH unlock preamble on brand so `/codex-vw` keeps a clean
  // direct-binary spawn (no `sh -c` wrapper).
  const cmd = brand === 'claude-code'
    ? (deps.wrapCommand ?? wrapCommandForKeychainUnlock)(rawCmd)
    : rawCmd;

  const content: PaneContentSpec = {
    kind: 'terminal',
    title,
    cmd,
    cwd,
    termName: 'xterm-ghostty',
    env: {
      // COLORTERM=truecolor — match xterm-ghostty's 24-bit capability.
      // pty-shell already injects this as a default, but we set it
      // here too so the env is self-contained for downstream readers.
      COLORTERM: 'truecolor',
      CLICOLOR_FORCE: '1',
      MONAD_AGENT_BRAND: brand,
    },
  };
  const window = registry.spawn({
    title,
    initialContent: content,
  });
  const paneId = window.focused;
  void paneDeps;   // suppressed — paneDeps flows via initVirtualWindowTools

  return {
    output: `SpawnCodingAgentInVW brand=${brand} window_id=${window.id} pane_id=${paneId} title="${title}" cmd="${rawCmd}"\n  use @pane:${paneId} to inline output or PaneInject to send input.`,
    windowId: window.id,
    paneId,
    brand,
  };
}
