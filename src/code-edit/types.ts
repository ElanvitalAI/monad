// Code editing types — Phase CE1.
//
// Follows DESIGN-code-edit.md §1. Claude Code's (file_path, edits[])
// schema for the LLM-facing tool + Codex's SafetyCheck variant for
// the approval decision. Everything here is data — no I/O.

/** A file the LLM has Read this session. Edits against files missing
 *  from this state are rejected; that's the "Read-before-Edit"
 *  invariant from Claude Code that prevents the model from guessing
 *  content and editing blind. */
export interface ReadFileEntry {
  /** Absolute path. */
  path: string;
  /** Date.now() at the time of Read. */
  ts: number;
  /** True when Read used offset/limit — partial views can't be safely
   *  used as the basis for an exact-match edit. */
  partialView: boolean;
  /** SHA-256 of the content seen by Read. Used at Edit time to detect
   *  external modification between Read and Edit. Absent for partial
   *  views (content mismatch is expected). */
  contentHash?: string;
}

/** A single "replace this text with that" operation inside one file.
 *  A batch of these forms an EditRequest. */
export interface EditSpec {
  old_string: string;
  new_string: string;
  /** When true, replace every occurrence. When false (default), fail
   *  if `old_string` appears more than once. */
  replace_all?: boolean;
}

export interface EditRequest {
  file_path: string;
  edits: EditSpec[];
}

export interface WriteRequest {
  file_path: string;
  content: string;
}

/** The `diff` library's hunk shape, re-declared here so consumers
 *  don't have to import `diff` types directly. Shape matches
 *  `StructuredPatchHunk` from the upstream package. */
export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];   // each prefixed with ' ', '+', or '-'
}

export enum EditErrorCode {
  /** `old_string === new_string` on every edit — nothing would change. */
  NoChange = 0,
  /** File path is in a denied directory per the policy. */
  PathDenied = 1,
  /** File doesn't exist on disk. */
  FileNotFound = 2,
  /** Trying to Edit a file that Write would have to create. */
  AlreadyExists = 3,
  /** Jupyter notebook — use a dedicated notebook tool. */
  NotebookFile = 4,
  /** Caller didn't Read this file first (or read with a partial view). */
  NotReadFirst = 5,
  /** Disk content differs from what Read saw — re-Read required. */
  ModifiedSinceRead = 6,
  /** `old_string` doesn't appear in the current file. */
  OldStringNotFound = 7,
  /** `old_string` matches in multiple places and `replace_all` is false. */
  MultipleMatches = 8,
  /** Shape validation (missing field, wrong type). */
  ValidationError = 9,
  /** fs.writeFile / fs.readFile itself failed. */
  IoFailed = 10,
  /** Policy rejected the edit (auto, not user). E.g. path inside a
   *  denied directory. */
  PolicyRejected = 11,
  /** User declined the approval prompt. The LLM may retry with a
   *  different approach — the request itself was not malformed. */
  UserRejected = 12,
  /** Policy requires approval but no approver is wired (running
   *  headless?). Safer than silently auto-approving. */
  ApproverMissing = 13,
}

export interface EditError {
  ok: false;
  code: EditErrorCode;
  message: string;
  /** Structured details (matchCount, expectedHash, etc.) for the LLM
   *  to read when deciding how to retry. */
  meta?: Record<string, unknown>;
}

export interface EditResult {
  ok: true;
  file_path: string;
  structuredPatch: StructuredPatchHunk[];
  originalContent: string;
  newContent: string;
  edits: EditSpec[];
  linesAdded: number;
  linesRemoved: number;
}

export type EditOutcome = EditResult | EditError;

/** Safety decision emitted by assessEdit(). Mirrors the three-way
 *  Codex `SafetyCheck` enum. */
export type SafetyDecision =
  | { kind: 'auto-approve' }
  | { kind: 'ask-user'; reason: string }
  | { kind: 'reject'; reason: string };

export interface ApprovalPolicy {
  mode: 'unsupervised' | 'ask-edit' | 'ask-all' | 'trusted-dirs';
  /** Absolute directory prefixes that count as pre-approved in
   *  trusted-dirs mode. Ignored in other modes. */
  trustedDirs?: string[];
  /** Absolute directory prefixes that always require approval
   *  regardless of mode (e.g. ~/.ssh, system configs). */
  deniedDirs?: string[];
  /** PLAN §4.2 — directories that the editor itself should treat as
   *  system files. Edits inside these dirs are ALWAYS escalated to
   *  ask-user regardless of mode (incl. unsupervised), and the
   *  approval prompt carries a "self-edit · UndoTurn 자동 묶음"
   *  reason. Default = the monad-agent repo root (auto-detected via
   *  the package-name walk). Disable via env `MONAD_SYSTEM_FILE_GUARD=off`. */
  systemFileDirs?: string[];
}
