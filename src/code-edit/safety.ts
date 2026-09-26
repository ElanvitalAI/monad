// Policy gate for Edit / Write — Phase CE4.
//
// Adapted from codex-rs/core/src/safety.rs (Apache 2.0). The enum is
// the same three-valued `SafetyCheck { AutoApprove | AskUser | Reject }`;
// the policies are Elanous-specific (no sandbox / landlock story yet,
// just a trusted-dirs whitelist + ask modes).
//
// Default policy is `ask-edit` — any Edit/Write asks the user before
// applying. `/code-edit policy <mode>` flips it at runtime.
//
// assessEdit/assessWrite are pure: given (request, policy), return a
// decision. Calling code handles the decision — auto-approve → apply;
// ask-user → invoke the approver; reject → return an EditError.

import { isAbsolute, resolve } from 'path';
import { getSessionCwd } from '../session/working-dir.js';
import type {
  ApprovalPolicy,
  EditRequest,
  SafetyDecision,
  StructuredPatchHunk,
  WriteRequest,
} from './types.js';
import {
  getDefaultSystemFileDirs,
  isSystemFileGuardDisabled,
} from './system-file-guard.js';

/** PLAN §4.2 — default policy seeds `systemFileDirs` from the
 *  monad-agent repo root walk. Computed lazily so tests that
 *  override the cwd via tmpdirs can still drive a clean default. */
function defaultPolicy(): ApprovalPolicy {
  return {
    mode: 'ask-edit',
    systemFileDirs: getDefaultSystemFileDirs(),
  };
}

let activePolicy: ApprovalPolicy = defaultPolicy();

export function getPolicy(): ApprovalPolicy {
  // Defensive copy so callers can't mutate the module state.
  return {
    mode: activePolicy.mode,
    trustedDirs: activePolicy.trustedDirs ? [...activePolicy.trustedDirs] : undefined,
    deniedDirs: activePolicy.deniedDirs ? [...activePolicy.deniedDirs] : undefined,
    systemFileDirs: activePolicy.systemFileDirs ? [...activePolicy.systemFileDirs] : undefined,
  };
}

export function setPolicy(policy: ApprovalPolicy): void {
  // PLAN §4.2 — preserve `systemFileDirs` across mode flips when
  // the caller doesn't explicitly clear or override it. The
  // dashboard slash for `/code-edit policy <mode>` only sets
  // `mode`; without this carry-through the self-edit guard would
  // disappear the moment the user touched the policy.
  const inheritedSystem = policy.systemFileDirs !== undefined
    ? policy.systemFileDirs
    : activePolicy.systemFileDirs;
  activePolicy = {
    mode: policy.mode,
    trustedDirs: policy.trustedDirs ? [...policy.trustedDirs] : undefined,
    deniedDirs: policy.deniedDirs ? [...policy.deniedDirs] : undefined,
    systemFileDirs: inheritedSystem ? [...inheritedSystem] : undefined,
  };
}

export function resetPolicyToDefault(): void {
  activePolicy = defaultPolicy();
}

// ── Pure assessment ───────────────────────────────────────────────

export function assessEdit(req: EditRequest, policy: ApprovalPolicy): SafetyDecision {
  if (!req.edits || req.edits.length === 0) {
    return { kind: 'reject', reason: 'empty edits array' };
  }
  return assessPath(req.file_path, policy);
}

export function assessWrite(req: WriteRequest, policy: ApprovalPolicy): SafetyDecision {
  if (typeof req.content !== 'string') {
    return { kind: 'reject', reason: 'content is not a string' };
  }
  return assessPath(req.file_path, policy);
}

function assessPath(rawPath: string, policy: ApprovalPolicy): SafetyDecision {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { kind: 'reject', reason: 'empty file_path' };
  }
  // WD4 — resolve relative paths against the session working
  // directory, not the boot cwd. Policy's trustedDirs/deniedDirs are
  // still absolute paths, so only the target path's resolution moves.
  const abs = isAbsolute(rawPath) ? rawPath : resolve(getSessionCwd(), rawPath);

  // Denied dirs are absolute: any edit inside them is rejected
  // outright regardless of policy mode.
  if (policy.deniedDirs) {
    for (const denied of policy.deniedDirs) {
      if (isInside(abs, denied)) {
        return { kind: 'reject', reason: `path is under denied directory: ${denied}` };
      }
    }
  }

  // PLAN §4.2 — Self-edit guard. Edits inside monad-agent's own
  // source tree always require user approval, regardless of mode.
  // Tier ordering matters: the check runs AFTER deniedDirs (so a
  // user-locked path stays rejected) but BEFORE the per-mode
  // switch (so `unsupervised` / `trusted-dirs` can't auto-approve
  // a self-edit). UndoTurn auto-attaches via the existing
  // `captureIfFirstMutationOfTurn` hook in apply.ts — the guard
  // does not need to wire that path explicitly.
  if (policy.systemFileDirs && policy.systemFileDirs.length > 0 && !isSystemFileGuardDisabled()) {
    for (const sysDir of policy.systemFileDirs) {
      if (isInside(abs, sysDir)) {
        return {
          kind: 'ask-user',
          reason: `elanous self-source (${sysDir}) — UndoTurn auto-attached`,
        };
      }
    }
  }

  switch (policy.mode) {
    case 'unsupervised':
      return { kind: 'auto-approve' };
    case 'ask-all':
      return { kind: 'ask-user', reason: 'policy: ask-all (every Edit requires approval)' };
    case 'ask-edit':
      // Same semantics as ask-all for now — kept separate so future
      // policy could differentiate Edit-only ask from Edit+tool ask.
      return { kind: 'ask-user', reason: 'policy: ask-edit' };
    case 'trusted-dirs': {
      const trusted = policy.trustedDirs ?? [];
      if (trusted.length === 0) {
        return { kind: 'ask-user', reason: 'policy: trusted-dirs but list is empty' };
      }
      const inTrusted = trusted.some((d) => isInside(abs, d));
      return inTrusted
        ? { kind: 'auto-approve' }
        : { kind: 'ask-user', reason: 'outside trusted-dirs' };
    }
  }
}

/** True if `path` is `dir` itself or a descendant. Avoids the classic
 *  "~/work" matching "~/work-other" by requiring
 *  either exact match or a trailing separator. */
function isInside(path: string, dir: string): boolean {
  const normDir = dir.endsWith('/') ? dir : dir + '/';
  return path === dir || path.startsWith(normDir);
}

// ── Approver wiring ────────────────────────────────────────────────
//
// The runtime hands a path + kind + diff preview to this function;
// returns true when the user approves. Undefined means "no approver
// registered" — the runtime then falls back to auto-approve (CLI
// skill mode) or rejects (if safer-by-default is desired).

export interface CodeEditApprovalRequest {
  kind: 'edit' | 'write';
  file_path: string;
  /** Short human description ("42 lines added, 7 removed"). */
  changeSummary: string;
  /** Reason from the SafetyDecision, for display in the modal. */
  reason?: string;
  /** R10a — optional diff preview payload for approval surfaces. */
  preview?: {
    structuredPatch: StructuredPatchHunk[];
    originalContent: string;
    newContent: string;
    linesAdded: number;
    linesRemoved: number;
  };
}

export type CodeEditApprover = (req: CodeEditApprovalRequest) => Promise<boolean>;

let approver: CodeEditApprover | null = null;

export function setCodeEditApprover(fn: CodeEditApprover | null): void {
  approver = fn;
}

export function getCodeEditApprover(): CodeEditApprover | null {
  return approver;
}
