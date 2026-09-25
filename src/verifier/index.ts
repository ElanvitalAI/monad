// Arc D — Verifier public exports.
//
// Hook entry: `runVerifier()` invoked by tool-runtime registry after a
// runtime returns; consumers (catalog entry authors) only need to
// declare `verifier?: VerifierSpec` and (optionally) register a schema
// when using `{kind:'schema', schemaRef}` or `{kind:'json-structure', schemaRef}`.

export type {
  VerifierBuiltinKind,
  VerifierSpec,
  VerifierIssueSeverity,
  VerifierIssue,
  VerifierReport,
  VerifierContext,
  VerifierBuiltin,
} from './types.js';

export {
  runVerifier,
  isVerifierDisabled,
  disabledRecordFor,
  reEnableVerifier,
  listDisabledVerifiers,
  __resetVerifierTrackerForTests,
} from './hook.js';

export {
  registerVerifierSchema,
  getVerifierSchema,
  __resetVerifierSchemaRegistryForTests,
} from './builtins/schema.js';
