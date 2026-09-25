// Expression-layer debug wrapper — standardizes the
// `expression.<surface>.<event>` category convention used at every
// critical junction (renderer entry, spec parse, lifecycle transition,
// state machine step). Wraps the global `debug.log` so the gate
// (`debug.enabled`) and sink behaviour stay identical to the rest of
// the codebase.
//
// Convention:
//   exprDebug('color', 'detect-profile', { profile: 'truecolor' });
//   → debug.log('expression.color.detect-profile', '', payload)
//
// The flat category form keeps `/debug tail` filters cohesive when
// scoping by `expression.*` while still allowing a per-surface filter
// like `expression.color.*`.

import { debug } from '../debug/log.js';

export const debugEnabled = (): boolean => debug.enabled;

/** Log an expression-layer event. Cheap when `debug.enabled` is
 *  false — the wrapper short-circuits before allocating the payload
 *  category string. */
export function exprDebug(
  surface: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!debug.enabled) return;
  debug.log(`expression.${surface}`, event, data);
}
