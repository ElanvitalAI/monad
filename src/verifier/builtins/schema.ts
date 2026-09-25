// Arc D — `schema` builtin verifier.
//
// Wraps `src/cft/pokayoke.ts` `validate()` so the Poka-Yoke validator
// becomes the verifier hook's first builtin without forcing a code
// migration of pokayoke itself (re-export pattern · PLAN §3 Arc D).

import { validate, type PokaSchema } from '../../cft/pokayoke.js';
import type {
  VerifierBuiltin,
  VerifierIssue,
  VerifierReport,
  VerifierSpec,
} from '../types.js';

/** Module-local schema registry. Keys are referenced by
 *  `VerifierSpec.schemaRef`. Phase 2 ships a tiny hardcoded set —
 *  callers can extend via `registerVerifierSchema(key, schema)`. */
const REGISTRY = new Map<string, PokaSchema>();

export function registerVerifierSchema(key: string, schema: PokaSchema): void {
  REGISTRY.set(key, schema);
}

export function getVerifierSchema(key: string): PokaSchema | undefined {
  return REGISTRY.get(key);
}

/** Test seam — restore the registry between specs. */
export function __resetVerifierSchemaRegistryForTests(): void {
  REGISTRY.clear();
}

export const schemaBuiltin: VerifierBuiltin = (
  _args,
  result,
  spec,
) => {
  if (spec.kind !== 'schema') {
    return { ok: true, issues: [] };
  }
  const schema = REGISTRY.get(spec.schemaRef);
  if (!schema) {
    // Missing schema is configuration error, not a tool defect — info severity.
    // mkReport keeps ok=true when only info issues are present (PLAN §5.3
    // footnote 4: info severity is display-only, never injected into LLM context).
    return mkReport([{
      code: 'schema.missing-ref',
      severity: 'info',
      message: `verifier schema "${spec.schemaRef}" is not registered`,
      hint: 'Call registerVerifierSchema(key, schema) at startup to enable this verifier.',
    }]);
  }
  const field = spec.field ?? 'data';
  const target = (result as Record<string, unknown>)[field];
  const r = validate(target, schema);
  if (r.ok) return { ok: true, issues: [] };
  const issues: VerifierIssue[] = r.errors.map(e => ({
    code: `schema.${e.code}`,
    severity: 'warn',
    message: `${e.path.length > 0 ? e.path.join('.') + ': ' : ''}${e.message}`,
    path: e.path,
    hint: schemaHint(e.code),
  }));
  return mkReport(issues);
};

function schemaHint(code: string): string | undefined {
  switch (code) {
    case 'required': return 'Add the missing field to your output.';
    case 'type':     return 'Match the expected primitive/structure type.';
    case 'enum':     return 'Pick one of the allowed enum values.';
    case 'pattern':  return 'Adjust the value to match the required pattern.';
    case 'min':
    case 'max':     return 'Length / numeric bound violated — clamp the value.';
    case 'literal': return 'Field must equal the expected literal.';
    case 'extra':   return 'Strict object — drop the extra field.';
    case 'union':   return 'Value matched none of the union variants.';
    default:        return undefined;
  }
}

function mkReport(issues: VerifierIssue[]): VerifierReport {
  // info-only issues do not flip ok=false (PLAN §5.3 footnote 4 —
  // info severity is display-only, never injected into LLM context).
  const consequential = issues.filter(i => i.severity !== 'info');
  return { ok: consequential.length === 0, issues };
}
