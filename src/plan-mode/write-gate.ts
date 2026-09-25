// Plan-mode write gate — Phase WF3.
//
// Called by src/code-edit/apply.ts at the entry of applyEdit /
// applyWrite. When plan mode is active, only the session's plan file
// is writable; everything else comes back as a structured error the
// LLM can interpret + recover from (typically by editing the plan
// file instead, or by calling ExitPlanMode to implement).

import { resolve, isAbsolute } from 'path';
import { getPlanModeState } from './session.js';
import { getSessionCwd } from '../session/working-dir.js';
import type { PlanModeError } from './types.js';

// WD4 — canonicalise against the session working directory so the
// plan-gate's allowlist check stays in sync with code-edit's path
// resolver. Flipping one without the other would let Edit write to
// /tmp/X/foo.ts while the gate still evaluates against repo-root/
// foo.ts and allows the wrong target.
function canon(p: string): string {
  return isAbsolute(p) ? p : resolve(getSessionCwd(), p);
}

/** Returns null when the write is allowed; a PlanModeError otherwise.
 *  Safe to call when plan mode is inactive — immediate null return. */
export function assertPlanGate(filePath: string): PlanModeError | null {
  const s = getPlanModeState();
  if (!s.active) return null;
  const target = canon(filePath);
  const allowed = canon(s.planFilePath);
  if (target === allowed) return null;
  return {
    code: 'PlanModeWriteBlocked',
    path: target,
    message:
      `Plan mode is active — only ${s.planFilePath} is writable. `
      + `Edit the plan file instead, or call ExitPlanMode to hand off for implementation.`,
  };
}
