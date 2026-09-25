// NEXUS · pwa-host kind register/auto-start (extracted from nexus/index.ts in C-2b)
//
// Sibling to `register-daemon.ts` (see C-2a). god-file pressure relief
// per `내부 문서 `ROADMAP-nexus-daemon-naming-cleanup-2026-05-08`` §C-2.
// Insertion-only style: same logic, just relocated. No behavioural change.
//
// PR η — pwa-host is opt-in (`enablePwaHostTab` from opts). Default OFF.
// Templates (PR κ) own their own tab set, so when a template is applied
// we skip the default-register block.

import type { TabRegistry } from '../state/tab-registry.js';
import type { Supervisor } from '../supervisor/index.js';
import {
  createPwaHostTabSpec,
  PWA_HOST_DEFAULT_TAB_ID,
} from '../kinds/pwa-host.js';

export interface RegisterPwaHostInputs {
  registry: TabRegistry;
  templateApplied: boolean;
  opts: {
    enablePwaHostTab?: boolean;
  };
}

/** PR η — pwa-host opt-in (default OFF; user toggles per OQ1 answer).
 *  Suppressed when a template is in effect — the template owns the tab set.
 *  Returns true iff the tab was registered (caller gates auto-start). */
export function tryRegisterPwaHost({ registry, templateApplied, opts }: RegisterPwaHostInputs): boolean {
  const registerPwaHost = !templateApplied && opts.enablePwaHostTab === true;
  if (registerPwaHost) {
    registry.register(createPwaHostTabSpec());
  }
  return registerPwaHost;
}

export interface AutoStartPwaHostInputs {
  supervisor: Supervisor;
  /** Result of `tryRegisterPwaHost` — gate the auto-start. */
  registered: boolean;
  opts: {
    autoStartPwaHostTab?: boolean;
    detachForTesting?: boolean;
  };
}

/** PR η — pwa-host auto-start (only when explicitly registered). */
export function tryAutoStartPwaHost({ supervisor, registered, opts }: AutoStartPwaHostInputs): void {
  if (!registered) return;
  const autoStartPwa = opts.autoStartPwaHostTab ?? !opts.detachForTesting;
  if (autoStartPwa) {
    void supervisor.startTab(PWA_HOST_DEFAULT_TAB_ID).catch(() => { /* swallow */ });
  }
}
