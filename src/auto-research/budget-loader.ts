// ── PFC-S4 P1 helper: persisted-spec-aware BudgetMeter loader ──
//
// `BudgetMeter.load(path, spec, now)` always uses the spec passed in —
// even when budget.json on disk has its own spec. For auto-research
// tools that only know the goal path (not the original spec), we need
// to recover the spec from disk. This helper wraps load() with the
// spec-from-file override plus the empty-spec fallback for brand new
// goals.

import { existsSync, readFileSync } from 'node:fs';
import { BudgetMeter, type BudgetSpec } from './budget-meter.js';

export function loadGoalBudget(path: string, fallbackSpec: BudgetSpec = {}, now: number = Date.now()): BudgetMeter {
  if (!existsSync(path)) return new BudgetMeter(fallbackSpec, undefined, now);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { spec?: BudgetSpec; usage?: unknown };
    const spec: BudgetSpec = raw.spec && typeof raw.spec === 'object' ? raw.spec : fallbackSpec;
    return BudgetMeter.load(path, spec, now);
  } catch {
    return new BudgetMeter(fallbackSpec, undefined, now);
  }
}
