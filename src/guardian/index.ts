// Arc B — Guardian public surface.

export {
  runGuardian,
  summarizeArgs,
  isGuardianEnabled,
  __resetGuardianForTests,
} from './check.js';

export {
  appendGuardianAudit,
  setGuardianAuditRootForTesting,
  setGuardianAuditSinkForTesting,
} from './audit-sink.js';

export type {
  GuardianSpec,
  GuardianVerdict,
  GuardianDecision,
  GuardianContext,
  GuardianSurface,
} from './types.js';

export type { GuardianAuditEvent } from './audit-sink.js';
