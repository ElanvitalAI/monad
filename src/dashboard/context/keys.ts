// IDX-2b — singleton ContextKeyService owned by the dashboard.
//
// One instance per runtime. Dashboard wires it into:
//   - resolver deps (ResolverDeps.getContextKeys)
//   - mountViewAsModalSurface hooks (via spec.contextKeyService fallback)
//   - PFC bridges (auto-mode / andon)
//   - LLM introspection tools (IDX-4: GetInputPolicy V2)
//
// Why a module-level singleton: every surface that needs to update
// keys lives in a different subsystem (chat.ts, mouseWiring,
// terminalModalRouter, auto-research, cft/andon). Passing a service
// instance through every boundary clutters signatures; a singleton
// with a single reset hook for tests is pragmatic here.

import {
  createContextKeyService,
  type ContextKeyService,
  type ContextKeys,
} from '../../input-core/context-keys.js';

let service: ContextKeyService | null = null;

/** Returns the singleton. Lazy-inits on first call. */
export function getDashboardContextKeyService(): ContextKeyService {
  if (!service) service = createContextKeyService();
  return service;
}

/** Convenience — equivalent to `getDashboardContextKeyService().keys`.
 *  Suitable for `ResolverDeps.getContextKeys`. */
export function getDashboardContextKeys(): Readonly<ContextKeys> {
  return getDashboardContextKeyService().keys;
}

/** Convenience — merge a patch into the singleton. Equivalent to
 *  `getDashboardContextKeyService().update(patch)`. */
export function updateDashboardContextKeys(patch: Partial<ContextKeys>): void {
  getDashboardContextKeyService().update(patch);
}

/** Test helper — drop the singleton so the next get creates a fresh
 *  service. Dashboard is never re-initialised at runtime; this is
 *  strictly for test hermeticity. */
export function __resetDashboardContextKeysForTests(): void {
  service = null;
}
