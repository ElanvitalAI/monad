// F-B2 — In-memory scenario registry.
//
// Central catalog for `Scenario` objects the `/playground` slash
// command can enumerate + dispatch by id. Built as a plain class
// (not a singleton) so tests can instantiate isolated registries
// per case; production wires a single shared instance through
// `getDefaultScenarioRegistry()` below.

import type { Scenario } from './types.js';

export class ScenarioRegistry {
  private byId = new Map<string, Scenario>();

  register(scenario: Scenario): void {
    if (!scenario.id) throw new Error('scenario.id must be non-empty');
    this.byId.set(scenario.id, scenario);
  }

  registerAll(scenarios: readonly Scenario[]): void {
    for (const s of scenarios) this.register(s);
  }

  /** Remove a scenario by id. Returns true when something was
   *  actually removed. */
  unregister(id: string): boolean {
    return this.byId.delete(id);
  }

  get(id: string): Scenario | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** All registered scenarios sorted by id. Stable ordering so
   *  `/playground list` output is reproducible across sessions. */
  list(opts: { tag?: string } = {}): Scenario[] {
    const all = [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (opts.tag) {
      return all.filter(s => (s.tags ?? []).includes(opts.tag!));
    }
    return all;
  }

  clear(): void {
    this.byId.clear();
  }
}

// ── Default (process-wide) registry ──────────────────────────────

let _defaultRegistry: ScenarioRegistry | null = null;

/** Lazy-init default registry. Production code registers into
 *  this at startup (via dashboard-playground-integration.ts);
 *  tests that want isolation should construct their own via
 *  `new ScenarioRegistry()` rather than use the default. */
export function getDefaultScenarioRegistry(): ScenarioRegistry {
  if (!_defaultRegistry) _defaultRegistry = new ScenarioRegistry();
  return _defaultRegistry;
}

/** Test-only hook to swap the default registry (or clear it
 *  between cases). Not part of the public API — exported so test
 *  harness can call it. */
export function _resetDefaultScenarioRegistryForTests(): void {
  _defaultRegistry = null;
}
