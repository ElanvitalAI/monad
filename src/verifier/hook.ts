// Arc D — Verifier afterCall hook + same-issue-3 disable guard.
//
// `runVerifier()` is the single entry point dispatchToolByName uses
// after a tool runtime returns. It looks up the spec.kind builtin and
// invokes it, then tracks (toolId, issue.code) repetition. After 3
// consecutive turns with the same issue code, the verifier for that
// tool is auto-disabled (R-D1, PLAN §3 Arc D Risks) and `audit` log
// records the suppression so an operator can see why hints stopped.
//
// The tracker is in-memory — survives only the lifetime of the
// process. Tests can reset via `__resetVerifierTrackerForTests()`.

import type {
  VerifierBuiltin,
  VerifierContext,
  VerifierReport,
  VerifierSpec,
} from './types.js';
import { schemaBuiltin } from './builtins/schema.js';
import { mermaidSyntaxBuiltin } from './builtins/mermaid-syntax.js';
import { jsonStructureBuiltin } from './builtins/json-structure.js';
import { fileExistsBuiltin } from './builtins/file-exists.js';
import { codeFeedbackBuiltin } from './builtins/code-feedback.js';

const BUILTINS: Record<string, VerifierBuiltin> = {
  'schema':          schemaBuiltin,
  'mermaid-syntax':  mermaidSyntaxBuiltin,
  'json-structure':  jsonStructureBuiltin,
  'file-exists':     fileExistsBuiltin,
  'code-feedback':   codeFeedbackBuiltin,
};

interface IssueTrack {
  /** Last code observed for this tool (consecutive run check). */
  lastCode: string | null;
  /** How many turns in a row the same code appeared. */
  streak: number;
}

interface DisabledRecord {
  toolId: string;
  code: string;
  disabledAt: number;
}

const tracker = new Map<string, IssueTrack>();
const disabled = new Map<string, DisabledRecord>();

/** When a tool runtime returns, dispatch this to attach a verifier
 *  report. Skips silently when the spec or builtin is missing. */
export async function runVerifier(
  spec: VerifierSpec,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  ctx: VerifierContext,
): Promise<VerifierReport> {
  const builtin = BUILTINS[spec.kind];
  if (!builtin) {
    return { ok: true, issues: [] };
  }
  const report = await builtin(args, result, spec, ctx);

  // Track the dominant code (first warn|error). info-only never trips
  // the same-issue-3 guard.
  const consequential = report.issues.find(i => i.severity !== 'info');
  if (consequential) {
    const t = tracker.get(ctx.toolId) ?? { lastCode: null, streak: 0 };
    if (t.lastCode === consequential.code) {
      t.streak += 1;
    } else {
      t.lastCode = consequential.code;
      t.streak = 1;
    }
    tracker.set(ctx.toolId, t);
    if (t.streak >= 3) {
      disabled.set(ctx.toolId, {
        toolId: ctx.toolId,
        code: consequential.code,
        disabledAt: Date.now(),
      });
    }
  } else {
    // Healthy run resets the streak.
    tracker.delete(ctx.toolId);
  }

  return report;
}

/** Returns true when verifier output for this tool is suppressed
 *  because the same issue repeated 3 turns in a row. dispatchToolByName
 *  consults this BEFORE calling runVerifier, so the offending builtin
 *  doesn't run at all once disabled. */
export function isVerifierDisabled(toolId: string): boolean {
  return disabled.has(toolId);
}

export function disabledRecordFor(toolId: string): DisabledRecord | undefined {
  return disabled.get(toolId);
}

/** Re-enable a previously auto-disabled tool. Use when an operator has
 *  fixed the underlying issue and wants verifier hints back. */
export function reEnableVerifier(toolId: string): void {
  disabled.delete(toolId);
  tracker.delete(toolId);
}

export function listDisabledVerifiers(): DisabledRecord[] {
  return [...disabled.values()];
}

/** Test seam — restore tracker + disabled state between specs. */
export function __resetVerifierTrackerForTests(): void {
  tracker.clear();
  disabled.clear();
}
