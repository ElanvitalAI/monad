// NEXUS · SwitchRegistry (Phase N-3 PR μ)
//
// In-memory schema registry. Built-ins register themselves at module
// load via registerSwitch(); user-defined switches (e.g., from a
// template) can register at boot. The registry is a singleton — there
// is one canonical source of truth per nexus process.

import type { SwitchSpec } from './types.js';
import type { TabKind } from '../kinds/types.js';

const switchMap = new Map<string, SwitchSpec>();

export function registerSwitch(spec: SwitchSpec): void {
  if (switchMap.has(spec.id)) {
    // Last registration wins — useful for tests that re-register; tracked
    // implicitly via logs in the spec's hotApplicable handler.
  }
  switchMap.set(spec.id, spec);
}

export function getSwitch(id: string): SwitchSpec | undefined {
  return switchMap.get(id);
}

export function listSwitches(): SwitchSpec[] {
  return [...switchMap.values()];
}

/** Tab-scope switches that apply to a specific kind. */
export function listSwitchesForTabKind(kind: TabKind): SwitchSpec[] {
  return listSwitches().filter((sw) =>
    sw.scope === 'tab' && (!sw.appliesTo || sw.appliesTo.includes(kind)),
  );
}

export function clearSwitchRegistry(): void {
  switchMap.clear();
}

/** Resolve the literal switch id for a tab. Tab-scope ids declared in
 *  builtins use `<id>` as a placeholder (e.g., `tabs.<id>.httpPort`);
 *  this expands to `tabs.daemon:1.httpPort`. */
export function expandTabSwitchId(template: string, tabId: string): string {
  return template.replace('<id>', tabId);
}

/** Bulk loader — call once per process from the builtins entry point. */
export function loadBuiltinSwitches(specs: SwitchSpec[]): void {
  for (const s of specs) registerSwitch(s);
}
