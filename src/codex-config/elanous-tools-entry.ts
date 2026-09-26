// PLAN-codex-app-server-hermes-parity §5 Phase H3·2 (2026-05-16) —
// generate the toml body that goes inside the managed section of
// `~/.codex/config.toml`. Two pieces:
//
//   1. `default_permissions = ":workspace"` so codex stops prompting
//      for every file write / shell run inside the user's project.
//      Workspace-scoped sandbox is the dogfood UX target — outside-
//      workspace + dangerous commands still prompt.
//   2. `[mcp_servers.elanous-tools]` pointing at `elanous mcp serve` so
//      codex spawns our stdio MCP server and discovers the 5
//      elanous_* tools (H1·5a-e).
//
// Pure projector — no I/O, no fs access. Tests assert the exact
// emitted shape so we can detect accidental drift.

export interface ElanousToolsEntryOpts {
  /** Absolute path to the elanous CLI binary. Defaults to `'elanous'`
   *  (relies on PATH at codex's spawn time). Override when codex
   *  runs in an environment whose PATH won't see the user's
   *  ~/.local/bin / bun globals (e.g. launchd plists). */
  command?: string;
  /** Args after the binary. Default `['mcp', 'serve']`. */
  args?: string[];
  /** Extra environment variables to forward to the spawned MCP
   *  server. Defaults to an empty map; callers (NEXUS boot) may
   *  inject `ELANOUS_DAEMON_SOCKET` etc when needed. */
  env?: Record<string, string>;
  /** Override the `default_permissions` value. Pass `null` to skip
   *  emitting the line. Default `":workspace"`. */
  defaultPermissions?: string | null;
  /** rg / read tool calls can take a while on big vaults; keep the
   *  defaults conservative but generous. */
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
}

const DEFAULT_OPTS: Required<
  Omit<ElanousToolsEntryOpts, 'env' | 'defaultPermissions'>
> & { env: Record<string, string>; defaultPermissions: string | null } = {
  command: 'elanous',
  args: ['mcp', 'serve'],
  env: {},
  defaultPermissions: ':workspace',
  startupTimeoutSec: 30,
  toolTimeoutSec: 600,
};

/** Emit the toml body for the managed section. Caller wraps it with
 *  the markers (managed-block.ts) before splicing into config.toml. */
export function renderElanousToolsEntry(opts: ElanousToolsEntryOpts = {}): string {
  const merged = {
    ...DEFAULT_OPTS,
    ...opts,
    env: opts.env ?? DEFAULT_OPTS.env,
    defaultPermissions:
      opts.defaultPermissions === undefined
        ? DEFAULT_OPTS.defaultPermissions
        : opts.defaultPermissions,
  };
  const lines: string[] = [];
  if (merged.defaultPermissions !== null) {
    lines.push(`default_permissions = ${tomlString(merged.defaultPermissions)}`);
    lines.push('');
  }
  lines.push('[mcp_servers.elanous-tools]');
  lines.push(`command = ${tomlString(merged.command)}`);
  lines.push(`args = ${tomlArray(merged.args)}`);
  lines.push(`env = ${tomlInlineTable(merged.env)}`);
  lines.push(`startup_timeout_sec = ${formatSec(merged.startupTimeoutSec)}`);
  lines.push(`tool_timeout_sec = ${formatSec(merged.toolTimeoutSec)}`);
  return lines.join('\n');
}

function tomlString(value: string): string {
  // Basic-string escape — sufficient for paths and env values that
  // don't contain literal newlines. Backslash + quote are doubled.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function tomlArray(values: ReadonlyArray<string>): string {
  return `[${values.map((v) => tomlString(v)).join(', ')}]`;
}

function tomlInlineTable(table: Record<string, string>): string {
  const keys = Object.keys(table).sort();
  if (keys.length === 0) return '{}';
  const pairs = keys.map((k) => `${tomlKey(k)} = ${tomlString(table[k]!)}`);
  return `{ ${pairs.join(', ')} }`;
}

/** toml bare key — accept ASCII letters/digits/-/_; quote otherwise. */
function tomlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
  return tomlString(key);
}

/** Numbers in toml — integer when whole, float with `.0` otherwise.
 *  Both are valid for startup_timeout_sec / tool_timeout_sec; we
 *  match the Hermes-emitted float-with-decimal form so a diff against
 *  Hermes-rendered config stays small. */
function formatSec(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0.0';
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
