// NEXUS · daemon kind (Phase N-2 PR ζ)
//
// Wraps `elanous serve` as a supervisor-managed tab. Default policy per
// HANDOFF §2.2 + D-1/D-3/D-4:
//   - command:        [<elanous-bin>, 'serve']  (foreground; supervisor backgrounds it)
//   - health:         socket connect to elanousDaemonSocketPath() every 10s
//                     (stale after 30s → unhealthy)
//   - restart:        on-crash · backoff [5s, 15s, 60s] · maxPerHour 5
//   - external:       if `~/.elanous/elanous.pid` already holds an alive pid
//                     that is *not* this tab's child → status='external',
//                     skip startTab (sidebar shows ⚠ external)
//
// `--gateway-mode` is a *client* flag (telegram/discord ACP attach) and
// is intentionally NOT passed here — `elanous serve` itself is the daemon.

import type { TabKind, TabSpec } from './types.js';
import {
  elanousDaemonLockPath,
  elanousDaemonSocketPath,
  readElanousDaemonLock,
  isAliveElanousDaemonLock,
  type ElanousDaemonLockMeta,
} from '../../elanous-daemon.js';
import type { TabRegistry } from '../state/tab-registry.js';
import { pushEvent, type NexusState } from '../state/state.js';
import { debug } from '../../debug/log.js';
// PLAN-nexus-shell-followup U3 (2026-05-16) — kind-detail-view trim.
// createDaemonTabView · staticDaemonView · summarizeDaemon · haltHintDaemon
// 가 모두 외부 호출 없음 (TUI sidebar render 의 viewForTab 에서 사용
// 됐었지만 T4 이후 dead) — file 삭제 + 본 import 제거.

export const DAEMON_KIND: TabKind = 'daemon';
export const DAEMON_DEFAULT_TAB_ID = 'daemon:1';

export interface DaemonTabOpts {
  /** Defaults to 'daemon:1' so the sidebar has a stable id. */
  id?: string;
  /** User-facing label · defaults to id. */
  label?: string;
  /** Argv override for the spawn. Defaults to `[<elanous>, 'serve']`. */
  command?: string[];
  /** cwd override. Defaults to process.cwd(). */
  cwd?: string;
  /** Extra env pairs merged over process.env at spawn time. */
  env?: Record<string, string>;
  /** Override socket path probe target (default = elanousDaemonSocketPath()). */
  socketPath?: string;
}

function defaultElanousCommand(): string[] {
  // process.argv[1] points at the elanous bundle when invoked via `elanous nexus`.
  // Falls back to PATH lookup of `elanous` for tests / unusual entrypoints.
  const bin = process.argv[1];
  return [bin && bin.length > 0 ? bin : 'elanous', 'serve'];
}

/** Build a daemon TabSpec ready for `registry.register`. The supervisor
 *  uses spec.spawn / spec.health / spec.restart to drive lifecycle. */
export function createDaemonTabSpec(opts: DaemonTabOpts = {}): TabSpec {
  const id = opts.id ?? DAEMON_DEFAULT_TAB_ID;
  const command = opts.command ?? defaultElanousCommand();
  return {
    id,
    kind: DAEMON_KIND,
    label: opts.label ?? id,
    spawn: {
      command,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : { cwd: process.cwd() }),
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    },
    health: {
      kind: 'socket',
      intervalMs: 10_000,
      timeoutMs: 1_500,
      staleAfterMs: 30_000,
      spec: { path: opts.socketPath ?? elanousDaemonSocketPath() },
    },
    restart: {
      policy: 'on-crash',
      backoffMs: [5_000, 15_000, 60_000],
      maxPerHour: 5,
      graceMs: 2_000,
    },
    meta: {
      socketPath: opts.socketPath ?? elanousDaemonSocketPath(),
      lockPath: elanousDaemonLockPath(),
    },
  };
}

// PLAN-nexus-shell-followup U3 (2026-05-16) — createDaemonTabView +
// CreateDaemonTabViewOpts + summarizeDaemon + haltHintDaemon +
// staticDaemonView 모두 외부 caller 없음 (TUI sidebar viewForTab 의
// dead path). KindDetailView 의존 cascade 정리.

// ---------------------------------------------------------------------------
// External-process detection
// ---------------------------------------------------------------------------

export interface DetectExternalDaemonOpts {
  state: NexusState;
  registry: TabRegistry;
  tabId?: string;
  /** Override the lock-read backend (tests inject). */
  readLock?: () => ElanousDaemonLockMeta | null;
  isAlive?: (meta: ElanousDaemonLockMeta) => boolean;
}

export interface DetectExternalDaemonResult {
  outcome: 'external' | 'available' | 'reclaimed' | 'no-tab';
  externalPid?: number;
}

/** Inspect the shared `~/.elanous/elanous.pid` lock. If an alive pid is
 *  recorded and it is not this tab's own child, mark the tab as
 *  `external` (per HANDOFF D-4 + N-1 PR β status enum). Returns the
 *  decision so the caller (runNexus) can skip auto-start. */
export function detectExternalDaemon(opts: DetectExternalDaemonOpts): DetectExternalDaemonResult {
  const tabId = opts.tabId ?? DAEMON_DEFAULT_TAB_ID;
  const tab = opts.registry.get(tabId);
  if (!tab) return { outcome: 'no-tab' };

  const readLock = opts.readLock ?? readElanousDaemonLock;
  const isAlive = opts.isAlive ?? isAliveElanousDaemonLock;

  const meta = readLock();
  if (!meta || !isAlive(meta)) {
    // No external holder → tab is available for nexus to spawn.
    if (tab.status === 'external') {
      // Previous external is gone; clear status back to idle.
      opts.registry.patch(tabId, { status: 'idle', pid: undefined });
      pushEvent(opts.state, { kind: 'tab.down', tabId, detail: { reason: 'external-cleared' } });
      return { outcome: 'reclaimed' };
    }
    return { outcome: 'available' };
  }

  // External pid is alive. If it's the tab's own child (post-spawn) skip.
  if (tab.pid !== undefined && tab.pid === meta.pid) {
    return { outcome: 'available' };
  }

  opts.registry.patch(tabId, { status: 'external', pid: meta.pid });
  pushEvent(opts.state, {
    kind: 'tab.down',
    tabId,
    detail: { reason: 'external-detected', externalPid: meta.pid, host: meta.host },
  });
  if (debug.enabled) {
    debug.log('nexus.daemon.external', tabId, { pid: meta.pid });
  }
  return { outcome: 'external', externalPid: meta.pid };
}
