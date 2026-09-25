// NEXUS · tab kind types (Phase N-1 PR α — type-only stub)
//
// Implementations land in PR β (chat, webterm) · N-2 (daemon, pwa-host,
// channel-bot). PR α reserves the type surface so `state.ts` can compile
// and downstream code can import the union without forward-ref pain.
//
// Surface-unification v2.2 V2.2-8 (2026-05-11) — `'scheduler'` TabKind
// retired together with the dashboard scheduler view + server `/v1/
// scheduler*` endpoint group + `src/scheduler/**` 17 file deletion.

export type TabKind =
  | 'chat'         // TUI session view, no spawn (PR β)
  | 'webterm'      // PTY pane (PR β)
  | 'daemon'       // headless ACP server spawn (N-2)
  | 'pwa-host'     // Next dev server spawn (N-2)
  | 'channel-bot'  // telegram / discord bot spawn (N-2)
  | 'settings';    // SwitchRegistry editor view (N-3 cleanup PR α')

export type TabStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'unhealthy'
  | 'restarting'
  | 'crashed'
  | 'stopped'
  | 'external';   // shared lock holder is not our child (N-2 reaper)

export interface TabSpec {
  id: string;
  kind: TabKind;
  label: string;
  /** Spawn config — undefined for view-only kinds (chat). */
  spawn?: {
    command: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  /** Health check spec — schema lands in N-2. */
  health?: HealthCheckSpec;
  /** Restart policy — schema lands in N-2. */
  restart?: RestartPolicySpec;
  meta?: Record<string, unknown>;
}

export interface HealthCheckSpec {
  kind: 'http' | 'socket' | 'file-mtime' | 'ipc-ping' | 'process-alive' | 'never';
  intervalMs: number;
  timeoutMs?: number;
  staleAfterMs?: number;
  spec?: Record<string, unknown>;
}

export interface RestartPolicySpec {
  policy: 'never' | 'on-crash' | 'always';
  backoffMs: number[];
  maxPerHour: number;
  haltPatterns?: string[];
  graceMs?: number;
}

export interface TabState {
  spec: TabSpec;
  status: TabStatus;
  pid?: number;
  startedAt?: number;
  lastHealthAt?: number;
  lastHealthOk?: boolean;
  restartCount: number;
  restartCountWindowStart: number;
  lastError?: string;
  endpoints?: { kind: string; url: string }[];
}
