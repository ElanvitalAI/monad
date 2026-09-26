import { debug } from '../debug/log.js';
import { GOAL_RULES_POLICY } from './goal-author.js';

export const HARNESS_POLICY_ENV = 'ELANOUS_HARNESS_POLICY';
export const DOCUMENT_REFERENCES_ENV = 'ELANOUS_DOCUMENT_REFERENCES';

/** Supplies the parent policy or the canonical goal rules to every child entrypoint. */
export function harnessPolicyEnv(policy = process.env[HARNESS_POLICY_ENV]): Record<string, string> {
  return { [HARNESS_POLICY_ENV]: policy ?? GOAL_RULES_POLICY.join('\n') };
}

/** Applies the optional parent policy at the front of the child instruction. */
export function applyHarnessPolicy(systemPrompt: string | undefined, policy = process.env[HARNESS_POLICY_ENV]): string | undefined {
  if (policy === undefined) return systemPrompt;
  debug.log('self-implement', 'harness-policy-applied', { length: policy.length });
  return systemPrompt ? `${policy}\n\n${systemPrompt}` : policy;
}

/** Makes parent-provided document reference paths available to the child without requiring it to open them. */
export function applyDocumentReferences(systemPrompt: string | undefined, references = process.env[DOCUMENT_REFERENCES_ENV]): string | undefined {
  if (references === undefined) return systemPrompt;

  let parsed: unknown;
  try {
    parsed = JSON.parse(references);
  } catch {
    debug.log('self-implement', 'document-references-invalid', { reason: 'malformed-json' });
    return systemPrompt;
  }
  if (!Array.isArray(parsed)) {
    debug.log('self-implement', 'document-references-invalid', { reason: 'not-array' });
    return systemPrompt;
  }

  const paths = parsed
    .flatMap((reference) => {
      if (typeof reference === 'string') return [reference];
      if (reference && typeof reference === 'object' && typeof (reference as { path?: unknown }).path === 'string') {
        return [(reference as { path: string }).path];
      }
      return [];
    });
  if (paths.length === 0) return systemPrompt;

  const knownReferences = `Document references supplied by the parent (you may decide whether to open them):\n${paths.map((path) => `- ${path}`).join('\n')}`;
  debug.log('self-implement', 'document-references-applied', { count: paths.length });
  return systemPrompt ? `${systemPrompt}\n\n${knownReferences}` : knownReferences;
}
