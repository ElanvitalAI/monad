// NEXUS · settings kind register (extracted from nexus/index.ts in C-2c)
//
// Sibling to `register-daemon.ts` / `register-pwa-host.ts`. god-file
// pressure relief per `내부 문서 `ROADMAP-nexus-daemon-naming-cleanup-2026-05-08``
// §C-2. Insertion-only style: same logic, just relocated.
//
// PR α' — settings is **default ON** in production (so first-boot users
// see a settings entry). Tests stay single-purpose unless explicit
// `registerSettingsTab=true`. Template mode (PR κ) suppresses the default
// — the template owns the tab roster.
//
// Note: the `SettingsTabController` instance creation stays inline in
// `runNexus` because it captures `state`/`registry` already bound there.
// Only the register decision moves here.

import type { TabRegistry } from '../state/tab-registry.js';
import { createSettingsTabSpec } from '../kinds/settings.js';

export interface RegisterSettingsInputs {
  registry: TabRegistry;
  templateApplied: boolean;
  opts: {
    registerSettingsTab?: boolean;
    detachForTesting?: boolean;
  };
}

/** PR α' — settings kind opt-in. Default ON in production
 *  (`!detachForTesting`) so first-boot users see a settings entry;
 *  tests stay single-purpose unless they pass `registerSettingsTab=true`
 *  explicitly. Template mode (PR κ) skips by default — the template
 *  owns the tab roster.
 *
 *  Returns true iff the tab was registered (caller uses this to gate
 *  the SettingsTabController instance). */
export function tryRegisterSettings({ registry, templateApplied, opts }: RegisterSettingsInputs): boolean {
  const registerSettings = !templateApplied && (opts.registerSettingsTab ?? !opts.detachForTesting);
  if (registerSettings) {
    registry.register(createSettingsTabSpec());
  }
  return registerSettings;
}
