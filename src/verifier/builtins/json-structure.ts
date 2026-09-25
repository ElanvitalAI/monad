// Arc D — `json-structure` builtin verifier.
//
// Validates that `result[field ?? 'output']` parses as JSON. When
// `schemaRef` is set, follows up with a Poka-Yoke schema validation
// against the parsed value.

import { validate } from '../../cft/pokayoke.js';
import { getVerifierSchema } from './schema.js';
import type { VerifierBuiltin, VerifierIssue, VerifierReport } from '../types.js';

export const jsonStructureBuiltin: VerifierBuiltin = (
  _args,
  result,
  spec,
) => {
  if (spec.kind !== 'json-structure') {
    return { ok: true, issues: [] };
  }
  const field = spec.field ?? 'output';
  const raw = (result as Record<string, unknown>)[field];
  if (typeof raw !== 'string') {
    return mkReport([{
      code: 'json.not-string',
      severity: 'warn',
      message: `result["${field}"] is not a string`,
      hint: 'Tool should produce JSON as a serialised string.',
    }]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    return mkReport([{
      code: 'json.parse-error',
      severity: 'warn',
      message: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
      hint: 'Emit valid JSON — quote keys, escape control characters, no trailing commas.',
    }]);
  }
  if (!spec.schemaRef) {
    return { ok: true, issues: [] };
  }
  const schema = getVerifierSchema(spec.schemaRef);
  if (!schema) {
    return mkReport([{
      code: 'json.schema-missing-ref',
      severity: 'info',
      message: `verifier schema "${spec.schemaRef}" is not registered`,
      hint: 'Call registerVerifierSchema(key, schema) at startup.',
    }]);
  }
  const r = validate(parsed, schema);
  if (r.ok) return { ok: true, issues: [] };
  const issues: VerifierIssue[] = r.errors.map(e => ({
    code: `json.schema.${e.code}`,
    severity: 'warn',
    message: `${e.path.length > 0 ? e.path.join('.') + ': ' : ''}${e.message}`,
    path: e.path,
  }));
  return mkReport(issues);
};

function mkReport(issues: VerifierIssue[]): VerifierReport {
  const consequential = issues.filter(i => i.severity !== 'info');
  return { ok: consequential.length === 0, issues };
}
