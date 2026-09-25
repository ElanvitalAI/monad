// Arc D — Verifier hook types.
//
// `VerifierSpec` is what a `NativeToolCatalogEntry` declares to opt
// into post-call verification. `VerifierReport` is the data the hook
// returns — never an exception. LLM consumers read `verifierIssues`
// from the dispatch result and self-recover on the next turn.
//
// PLAN: 내부 문서 `PLAN-harness-arc-d-verifier`
// Track: harness-engineering meta · Phase 2 (coding-first lane)

import type { ToolRuntimeContext } from '../tool-runtime/types.js';

export type VerifierBuiltinKind =
  | 'schema'
  | 'mermaid-syntax'
  | 'json-structure'
  | 'file-exists'
  | 'code-feedback';

export type VerifierSpec =
  /** Validates `result[field ?? 'data']` against a registered Poka-Yoke
   *  schema (`src/cft/pokayoke.ts`). `schemaRef` is a key into the
   *  builtin's local registry — Phase 2 ships with a tiny hardcoded set
   *  (see `src/verifier/builtins/schema.ts`). */
  | { kind: 'schema'; schemaRef: string; field?: string }
  /** Validates `result[field ?? 'output']` as a Mermaid diagram source.
   *  Lightweight: checks for a recognised `<diagram-type>` keyword
   *  (`flowchart` / `graph` / `sequenceDiagram` / `classDiagram` /
   *  `stateDiagram` / `erDiagram` / `journey` / `gantt` / `pie` /
   *  `mindmap` / `timeline` / `gitGraph`) and balanced brackets. */
  | { kind: 'mermaid-syntax'; field?: string }
  /** Validates `result[field ?? 'output']` parses as JSON. Optional
   *  `schemaRef` for a follow-up Poka-Yoke validate after parse. */
  | { kind: 'json-structure'; field?: string; schemaRef?: string }
  /** Validates each path in `result[field]` (string or string[]) exists
   *  on disk. Useful for tools that claim to have written/created files. */
  | { kind: 'file-exists'; field: string }
  /** Arc G — post-Edit/Write code-feedback. Spawns `bunx tsc --noEmit`,
   *  compares the error count against `HARNESS_TSC_BASELINE` (default
   *  44), and reports a regression as a `warn` issue. Default
   *  **disabled** — set `HARNESS_CODE_FEEDBACK_ENABLED=1` to opt in
   *  (avoids surprising coding-turn latency). Timeout via
   *  `HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS` (default 30000); on timeout
   *  the builtin emits an `info` issue (streak 0). */
  | { kind: 'code-feedback' };

export type VerifierIssueSeverity = 'info' | 'warn' | 'error';

export interface VerifierIssue {
  /** Stable identifier — same `(toolId, code)` repeated 3 turns triggers
   *  the verifier-self-disable guard (R-D1, PLAN §3 Arc D). */
  code: string;
  severity: VerifierIssueSeverity;
  message: string;
  /** Optional self-recovery hint shown to the LLM. */
  hint?: string;
  /** Pointer into the offending field (when relevant). */
  path?: string[];
}

export interface VerifierReport {
  ok: boolean;
  issues: VerifierIssue[];
}

export interface VerifierContext {
  toolId: string;
  surface: ToolRuntimeContext['surface'];
}

export type VerifierBuiltin = (
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  spec: VerifierSpec,
  ctx: VerifierContext,
) => VerifierReport | Promise<VerifierReport>;
