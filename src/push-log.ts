// Compact-level-aware log pusher — T2-P7.
//
// Wraps chatLines.push() so callers can tag a line's severity and
// have the tablet-responsive compact levels automatically drop
// low-severity noise. tabletMini / tabletTwo viewports (≤26 rows,
// ≤80 cols) are space-starved — an automatic "show errors only"
// filter is the difference between "dashboard is legible" and
// "log pane is full of muted chatter the user can't scroll past".
//
// Severity → color mapping:
//
//   error    C.error (red)      — always visible
//   warning  C.warning (orange) — visible unless tabletMini drops it
//   info     C.muted (grey)     — dropped on tabletMini/Two
//   debug    C.subtext (dim)    — dropped on tabletMini/Two
//
// Adoption: new sites prefer pushLog over direct chatLines.push.
// Existing 400+ chatLines.push sites keep working unchanged — the
// filter only affects pushLog callers. Incremental migration as
// sites get visited for other reasons.

import { C } from './tui.js';
import type { CompactLevel } from './views/pane-policy.js';

export type LogSeverity = 'debug' | 'info' | 'warning' | 'error';

export interface PushLogDeps {
  /** The dashboard's chatLines array. Mutated in place. */
  chatLines: string[];
  /** Returns the current viewport's compact level. Called on every
   *  push so an adaptive viewport (user resizes mid-session) gets
   *  the right filter without a re-wire. */
  getCompactLevel: () => CompactLevel;
}

export interface PushLogOpts {
  /** Skip the severity drop — always push. Used by rare callers
   *  whose message is structurally important even on tabletMini
   *  (e.g. "confirmation pending" prompts). */
  force?: boolean;
}

export type PushLog = (severity: LogSeverity, line: string, opts?: PushLogOpts) => void;

const DROPPED_ON_COMPACT: Set<LogSeverity> = new Set(['debug', 'info']);

export function createPushLog(deps: PushLogDeps): PushLog {
  return (severity, line, opts = {}) => {
    if (!opts.force) {
      const level = deps.getCompactLevel();
      if ((level === 'tabletMini' || level === 'tabletTwo') && DROPPED_ON_COMPACT.has(severity)) {
        return;
      }
      // warning survives tabletTwo but drops on tabletMini — the
      // tighter viewport has truly no room for anything non-critical.
      if (level === 'tabletMini' && severity === 'warning') {
        return;
      }
    }
    deps.chatLines.push(colorize(severity, line));
  };
}

function colorize(severity: LogSeverity, line: string): string {
  switch (severity) {
    case 'error':   return C.error(line);
    case 'warning': return C.warning(line);
    case 'info':    return C.muted(line);
    case 'debug':   return C.subtext(line);
  }
}
