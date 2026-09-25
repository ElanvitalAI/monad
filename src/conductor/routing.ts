// ── PFC-S2 generalization: routing table ──
//
// Maps GoalKind → Adapter. Callers may override individual adapters
// via RouterDeps.adapters (test seam, or future plugin extension).

import { researchAdapter } from './adapters/research.js';
import { codingAdapter } from './adapters/coding.js';
import { analysisAdapter } from './adapters/analysis.js';
import { monitoringAdapter } from './adapters/monitoring.js';
import { refactorAdapter } from './adapters/refactor.js';
import type { Adapter, GoalKind, RouterDeps } from './types.js';

export const DEFAULT_ADAPTERS: Record<GoalKind, Adapter> = {
  research: researchAdapter,
  coding: codingAdapter,
  analysis: analysisAdapter,
  monitoring: monitoringAdapter,
  refactor: refactorAdapter,
};

export function selectAdapter(kind: GoalKind, deps: RouterDeps = {}): Adapter {
  const override = deps.adapters?.[kind];
  if (override) return override;
  const fallback = DEFAULT_ADAPTERS[kind];
  if (!fallback) {
    throw new Error(`selectAdapter: unknown goalKind '${kind}'`);
  }
  return fallback;
}
