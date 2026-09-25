import type { PtyControlTarget } from './registry.js';
import type { PtyWriteActor } from './pty-write-arbiter.js';

type PtyWriteOutcome = 'success' | 'denied' | 'write-failed';
type PtyResizeOutcome = 'success' | 'denied' | 'resize-failed';

/** Preflights the public write contract while retaining its arbiter enforcement for other callers. */
export function writePtyWithOutcome(handle: PtyControlTarget, chars: string, actor: PtyWriteActor = 'human'): PtyWriteOutcome {
  if (!handle.canWrite(actor)) return 'denied';
  try {
    handle.write(chars, actor);
    return 'success';
  } catch {
    return 'write-failed';
  }
}

/** Gates control-channel resize requests with the same access matrix as input. */
export function resizePtyWithOutcome(handle: PtyControlTarget, cols: number, rows: number, actor: PtyWriteActor = 'human'): PtyResizeOutcome {
  if (!handle.canWrite(actor)) return 'denied';
  try {
    handle.resize(cols, rows);
    return 'success';
  } catch {
    return 'resize-failed';
  }
}
