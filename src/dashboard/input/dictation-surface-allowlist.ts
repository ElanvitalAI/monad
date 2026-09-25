// PR-S1V.D4-γ (sprint 21-Parallel-Voice · 2026-04-29) — Plain-Space
// dictation surface allowlist.
//
// PR #1115 review uncovered that plain `Space` hold collides with too
// many existing PaneFocus surfaces — browser/obsidian/skill-file
// selection toggle, scheduler form input, preview pager next-page,
// popup/VW terminal raw char, modals/pickers. Reviewer's prescription:
// "global plain Space 포기, scoped plain Space 유지" — every surface
// is deny-by-default, opt-in via this allowlist after dogfood verifies
// the surface has no native Space binding.
//
// Initial allowlist is **intentionally empty**. Every PaneFocus value
// in `src/workspace-types.ts` is a known Space consumer:
//   - 'input'         → chat-main; owned by D4-β `Ctrl+Shift+Space`
//   - 'browser' / 'obsidian' / 'skill-file' / 'skill-browser'
//                     → file-list selection toggle on Space
//   - 'preview'       → preview pager next-page on Space
//   - 'scratch'       → text input
//   - 'log'           → currently no native Space binding, but reviewer
//                       wanted dogfood verification before adding
//   - 'scheduler-*'   → form text input + selection
//   - 'agent-roster' / 'agent-detail' / 'agent-log' / 'debug-*'
//                     → unverified
//   - 'playground' / 'sessions-sidebar' / 'plugin:*'
//                     → unverified
//
// To opt in a surface: prove via dogfood it has no Space binding,
// then add the value to ALLOWED_FOCUS_VALUES below + cite the
// verification dogfood note in the comment. Modifier-only
// `Ctrl+Shift+Space` is the chord that carries dictation across
// every other surface (see `dashboard/index.ts` outer-hook branch 1).
//
// Reference: PLAN-voice-and-dictation-unified-2026-04-29.md §5.3 +
// PR #1115 review thread.

import type { PaneFocus } from '../../workspace-types.js';

/** Set of PaneFocus values known-safe for plain-Space dictation
 *  capture. Each entry is verified to have no native Space binding
 *  that would conflict with hold-to-talk:
 *
 *    - `log`             — log scroll uses arrow keys / page-up/down,
 *                          Space has no binding
 *    - `playground`      — read-only viewer, no Space binding
 *    - `agent-log`       — log-style viewer
 *    - `debug-events` /
 *      `debug-detail` /
 *      `debug-stack` /
 *      `debug-prompts`   — debug viewers, no Space binding
 *
 *  Surfaces NOT in this set keep their native Space behavior (e.g.,
 *  `browser` selection toggle, `preview` pager next-page, `scratch`
 *  text input, `scheduler-*` form input). The chord (Ctrl+Shift+D /
 *  Ctrl+Shift+Space) toggle path stays available everywhere as a
 *  fallback for surfaces not opted into plain-Space dictation. */
const ALLOWED_FOCUS_VALUES: ReadonlySet<PaneFocus> = new Set<PaneFocus>([
  'log',
  'playground',
  'agent-log',
  'debug-events',
  'debug-detail',
  'debug-stack',
  'debug-prompts',
]);

/** Returns `true` when the focused surface is on the allowlist and
 *  the dashboard outer-hook may treat plain `Space` press/release as
 *  a dictation-hold candidate. Defaults to `false` for unknown values
 *  (defensive — `plugin:*` etc.). */
export function isAllowlistedDictationSurface(focus: PaneFocus): boolean {
  return ALLOWED_FOCUS_VALUES.has(focus);
}

/** Test helper — surface the current allowlist so future changes
 *  can be asserted without re-importing the private set. */
export function getAllowedDictationSurfaces(): readonly PaneFocus[] {
  return [...ALLOWED_FOCUS_VALUES];
}
