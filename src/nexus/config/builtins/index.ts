// NEXUS · SwitchRegistry built-ins entry point (Phase N-3 PR μ)
//
// Importing this module loads all built-in switches into the singleton
// registry. Call `loadAllBuiltins()` once at boot from runNexus.
//
// Surface-unification v2.2 V2.2-8 (2026-05-11) — SCHEDULER_SWITCHES
// retired together with the scheduler kind + src/scheduler/ tree.

import { loadBuiltinSwitches } from '../switch-registry.js';
import { CHAT_SWITCHES } from './tab-chat.js';
import { GLOBAL_SWITCHES } from './global.js';
import { CHANNEL_SWITCHES } from './tab-channel.js';
import { DAEMON_SWITCHES } from './tab-daemon.js';
import { PWA_HOST_SWITCHES } from './tab-pwa.js';

let loaded = false;

export function loadAllBuiltins(): void {
  if (loaded) return;
  loaded = true;
  loadBuiltinSwitches([
    ...GLOBAL_SWITCHES,
    ...CHAT_SWITCHES,
    ...DAEMON_SWITCHES,
    ...PWA_HOST_SWITCHES,
    ...CHANNEL_SWITCHES,
  ]);
}

/** Test seam — re-registers builtins after clearSwitchRegistry. */
export function reloadAllBuiltins(): void {
  loaded = false;
  loadAllBuiltins();
}

export {
  GLOBAL_SWITCHES,
  CHAT_SWITCHES,
  CHANNEL_SWITCHES,
  DAEMON_SWITCHES,
  PWA_HOST_SWITCHES,
};
