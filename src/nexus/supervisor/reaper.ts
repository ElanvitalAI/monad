// NEXUS · orphan reaper (Phase N-2 PR ε)
//
// Boot-time pass: for each persisted tab spec that recorded a `pid` from
// the previous nexus invocation, decide whether the OS process is still
// alive. Per HANDOFF D-3 we run reclaim *once* on boot only — no cron
// polling — and re-check at the next mutation site.
//
// Outcomes per tab:
//   - pid alive  → status='active' (assume alive until first health check
//                 verifies — health loop will demote to unhealthy if the
//                 process is reachable but the health probe fails)
//   - pid dead   → clear pid, status='stopped' (next mutation may restart)
//   - no pid     → leave as-is

import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import { debug } from '../../debug/log.js';
import { isPidAlive } from '../../process/pid-liveness.js';

export interface ReclaimOrphansOpts {
  state: NexusState;
  registry: TabRegistry;
  /** Default: process.kill(pid, 0) gate. Tests inject. */
  isAlive?: (pid: number) => boolean;
}

export interface ReclaimOutcome {
  tabId: string;
  outcome: 'reclaimed' | 'stopped' | 'no-pid';
  pid?: number;
}

export function reclaimOrphans(opts: ReclaimOrphansOpts): ReclaimOutcome[] {
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const results: ReclaimOutcome[] = [];

  for (const tab of opts.registry.list()) {
    if (tab.pid == null) {
      results.push({ tabId: tab.spec.id, outcome: 'no-pid' });
      continue;
    }
    if (isAlive(tab.pid)) {
      // Previous nexus left this child alive — keep ownership.
      // Next health probe will demote to unhealthy if appropriate.
      opts.registry.patch(tab.spec.id, { status: 'active' });
      pushEvent(opts.state, {
        kind: 'nexus.boot',
        tabId: tab.spec.id,
        detail: { reclaimed: true, pid: tab.pid },
      });
      if (debug.enabled) {
        debug.log('nexus.supervisor.reclaim', tab.spec.id, { pid: tab.pid });
      }
      results.push({ tabId: tab.spec.id, outcome: 'reclaimed', pid: tab.pid });
    } else {
      // Process is gone — clear pid, mark stopped.
      const deadPid = tab.pid;
      opts.registry.patch(tab.spec.id, { pid: undefined, status: 'stopped' });
      pushEvent(opts.state, {
        kind: 'tab.down',
        tabId: tab.spec.id,
        detail: { reason: 'orphan-dead', pid: deadPid },
      });
      if (debug.enabled) {
        debug.log('nexus.supervisor.reclaim.dead', tab.spec.id, { pid: deadPid });
      }
      results.push({ tabId: tab.spec.id, outcome: 'stopped', pid: deadPid });
    }
  }
  return results;
}

function defaultIsAlive(pid: number): boolean {
  // ⛔ EPERM 은 「죽음」이 아니다 — 공용 판정으로 모았다(2026-09-20 전수: 15곳 중 10곳이 접고 있었다)
    return isPidAlive(pid);
}
