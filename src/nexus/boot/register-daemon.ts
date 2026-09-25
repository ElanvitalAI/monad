// NEXUS · daemon kind register/auto-start (extracted from nexus/index.ts in C-2a)
//
// File-disjoint split for the god-file pressure relief described in
// `내부 문서 `ROADMAP-nexus-daemon-naming-cleanup-2026-05-08`` §C-2.
// Insertion-only style: same logic as before, just relocated. No
// behavioural change. The `runNexus` body still controls ordering by
// calling `tryRegisterDaemon` first and `tryAutoStartDaemon` later
// (after the supervisor + restore-from-pending have run).

import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
import type { Supervisor } from '../supervisor/index.js';
import {
  createDaemonTabSpec,
  detectExternalDaemon,
  DAEMON_DEFAULT_TAB_ID,
} from '../kinds/daemon.js';
import { readUserConfig, readSwitchValue } from '../config/user-config.js';

/** T5.F — daemon 탭 register 결정. Resolution order:
 *
 *    1. opts.registerDaemonTab (test override)
 *    2. UserConfig switch `global.tabs.registerDaemon` (true/false)
 *    3. env `MONAD_REGISTER_DAEMON` truthy
 *    4. detachForTesting → false (test fixture)
 *    5. else → false (production default-OFF · NEXUS SSoT 정책)
 *
 *  switch read 는 try/catch — 잘못된 config 가 boot 를 막지 않도록. */
export function shouldRegisterDaemon(opts: { registerDaemonTab?: boolean; detachForTesting?: boolean }): boolean {
  if (opts.registerDaemonTab !== undefined) return opts.registerDaemonTab;
  try {
    const cfg = readUserConfig();
    const v = readSwitchValue(cfg, 'global.tabs.registerDaemon');
    if (v === true) return true;
    if (v === false) return false;
  } catch { /* swallow */ }
  const env = process.env.MONAD_REGISTER_DAEMON?.trim().toLowerCase();
  if (env === '1' || env === 'true' || env === 'yes' || env === 'on') return true;
  return false;
}

export interface RegisterDaemonInputs {
  registry: TabRegistry;
  templateApplied: boolean;
  opts: {
    registerDaemonTab?: boolean;
    detachForTesting?: boolean;
  };
}

/** PR ζ — daemon kind auto-registers in production (HANDOFF D-5).
 *  Tests using detachForTesting skip the side-effect by default; opt-in
 *  via registerDaemonTab=true if a test explicitly wants the entry.
 *  Template mode (PR κ) suppresses default daemon registration — template
 *  declares the daemon entry explicitly if it wants one.
 *  T5.F — production default-OFF (NEXUS SSoT 정책). Test fixture +
 *  구사용자 muscle memory 는 switch / env / opts override 로 다시 노출.
 *
 *  Returns true iff the daemon tab was registered (caller uses this to
 *  gate the auto-start block). */
export function tryRegisterDaemon({ registry, templateApplied, opts }: RegisterDaemonInputs): boolean {
  const registerDaemon = !templateApplied && shouldRegisterDaemon({
    ...(opts.registerDaemonTab !== undefined ? { registerDaemonTab: opts.registerDaemonTab } : {}),
    ...(opts.detachForTesting !== undefined ? { detachForTesting: opts.detachForTesting } : {}),
  });
  if (registerDaemon) {
    registry.register(createDaemonTabSpec());
  }
  return registerDaemon;
}

export interface AutoStartDaemonInputs {
  state: NexusState;
  registry: TabRegistry;
  supervisor: Supervisor;
  /** Result of `tryRegisterDaemon` — gate the auto-start. */
  registered: boolean;
  opts: {
    autoStartDaemonTab?: boolean;
    detachForTesting?: boolean;
  };
}

/** PR ζ — daemon auto-start: external lock check first, then startTab.
 *  No-op when the tab was not registered. */
export function tryAutoStartDaemon({ state, registry, supervisor, registered, opts }: AutoStartDaemonInputs): void {
  if (!registered) return;
  const detection = detectExternalDaemon({ state, registry });
  const autoStartDaemon = opts.autoStartDaemonTab ?? !opts.detachForTesting;
  if (autoStartDaemon && detection.outcome !== 'external') {
    void supervisor.startTab(DAEMON_DEFAULT_TAB_ID).catch(() => {
      // Spawn errors surface via tab status / events — swallow here so
      // a missing `monad` binary doesn't block runNexus boot.
    });
  }
}
