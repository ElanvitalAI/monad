// Arc D — `file-exists` builtin verifier.
//
// Validates that each path in `result[spec.field]` (string or string[])
// exists on disk. Useful for tools that claim to have written/created
// files (Edit, Write, etc.).

import { existsSync } from 'fs';
import type { VerifierBuiltin, VerifierIssue, VerifierReport } from '../types.js';

export const fileExistsBuiltin: VerifierBuiltin = (
  _args,
  result,
  spec,
) => {
  if (spec.kind !== 'file-exists') {
    return { ok: true, issues: [] };
  }
  const raw = (result as Record<string, unknown>)[spec.field];
  const paths = normalisePaths(raw);
  if (paths === null) {
    return mkReport([{
      code: 'file-exists.field-shape',
      severity: 'warn',
      message: `result["${spec.field}"] must be a string or string[] of paths`,
      hint: 'Tool should expose its written paths under the configured field.',
    }]);
  }
  if (paths.length === 0) {
    // Empty list is benign — nothing to check.
    return { ok: true, issues: [] };
  }
  const issues: VerifierIssue[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      issues.push({
        code: 'file-exists.missing',
        severity: 'warn',
        message: `path does not exist: ${p}`,
        hint: 'Verify the path the tool reported actually lives on disk; rerun if the write was a no-op.',
      });
    }
  }
  return mkReport(issues);
};

function normalisePaths(raw: unknown): string[] | null {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw) && raw.every(p => typeof p === 'string')) {
    return raw as string[];
  }
  return null;
}

function mkReport(issues: VerifierIssue[]): VerifierReport {
  const consequential = issues.filter(i => i.severity !== 'info');
  return { ok: consequential.length === 0, issues };
}
