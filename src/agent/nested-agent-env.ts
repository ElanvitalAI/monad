/** Parent-only markers that make a spawned coding agent reject nested execution. */
export const NESTED_AGENT_ENV_BLOCKLIST = new Set<string>([
  'CLAUDECODE',
  'MONAD_SESSION_ID',
  'MONAD_UNDO_REF',
  'MONAD_GUARDIAN',
  'MONAD_UNDO',
  'MONAD_HITL_CALLBACK_PORT',
  'MONAD_HITL_PORT',
  'MONAD_HITL_PORT_SCAN_RANGE',
]);
