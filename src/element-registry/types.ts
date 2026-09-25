// Element kinds — stable union of every "thing" the LLM can address
// and control. Extended when a new sub-system joins (next candidates:
// 'remote-host', 'mcp-client').
//
// Addressing grammar:
//   win:<int>              — virtual window (sequential)
//   pane:<hex>             — pane inside a window (6-hex)
//   pty:<id>               — PTY shell (opaque, may keep legacy `pty_` prefix)
//   sess:<id>              — dashboard terminal-modal session
//   job:<id>               — scheduler / background job
//   widget:<type>:<n>      — widget instance
//   plugin:<id>            — activated plugin
//   tool:<name>            — native tool surface entry
//   task:<hex>             — orchestrator-managed task (TOX-1c)
//
// The Registry stores (kind, rawId, handle). Format/parse helpers in
// address.ts concatenate to the canonical `<kind>:<rawId>` form the
// LLM sees in `context.*` tool output.

export type ElementKind =
  | 'window'
  | 'pane'
  | 'pty'
  | 'session'
  | 'job'
  | 'widget'
  | 'plugin'
  | 'tool'
  | 'task';

/** Every element kind has a short prefix used in global addresses.
 *  Keep this in sync with ADDR_PREFIX_TO_KIND below. */
export const KIND_PREFIX: Record<ElementKind, string> = {
  window:  'win',
  pane:    'pane',
  pty:     'pty',
  session: 'sess',
  job:     'job',
  widget:  'widget',
  plugin:  'plugin',
  tool:    'tool',
  task:    'task',
};

export const ADDR_PREFIX_TO_KIND: Record<string, ElementKind> = Object.fromEntries(
  Object.entries(KIND_PREFIX).map(([k, v]) => [v, k as ElementKind]),
) as Record<string, ElementKind>;

/** Anything the registry holds. Concrete element modules extend this
 *  with their own interface (PtyHandle, VirtualWindow, etc.) and
 *  register the instance; registry only needs the kind+id pair. */
export interface ElementHandle {
  readonly kind: ElementKind;
  readonly id: string;
}

/** Parsed global address. `rest` is everything after the first prefix,
 *  so widget:wd-log:3 yields { kind:'widget', id:'wd-log:3' }. Keeping
 *  the nested id intact lets widget type + instance survive. */
export interface ParsedElementAddress {
  readonly raw: string;
  readonly kind: ElementKind;
  readonly id: string;
}
