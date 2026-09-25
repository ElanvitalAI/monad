// ── Presentation P5a · Scenario materialization ──
//
// Runs a `ScenarioDef` through the P3 declarative pipeline so the
// output is the same `WidgetSpec[]` the rest of the codebase already
// consumes (modal adapter, future dashboard wire, tests). Shorthand
// expansion happens once up-front so `decodeWidgetTree` never needs to
// know about the Flutter-flavoured YAML sugar.

import { decodeWidgetTree, type DecodeOptions, type DecodeResult } from '../ui/declarative/index.js';
import { expandScenarioShorthand } from './shorthand.js';
import type { ScenarioDef } from './types.js';

/** Materialize a scenario into WidgetSpec[]. Returns the standard
 *  DecodeResult so callers can inspect `errors` + fall back gracefully.
 *  Shorthand expansion is applied before the decode step — consumers
 *  never need to call `expandScenarioShorthand` explicitly. */
export function materializeScenario(
  def: ScenarioDef,
  options?: DecodeOptions,
): DecodeResult {
  const expanded = expandScenarioShorthand(def.layout);
  return decodeWidgetTree(expanded, options);
}
