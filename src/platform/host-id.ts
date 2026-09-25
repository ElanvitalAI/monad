import { getOrCreateMonadId } from '../mss/identity.js';

/** The supervisor's inherited installation identity wins over this process's local identity. */
export function resolveHostId(env: NodeJS.ProcessEnv = process.env): string {
  return env.MONAD_HOST_ID?.trim() ? env.MONAD_HOST_ID : getOrCreateMonadId();
}

/** Fix the identity at the launch boundary for child and pod environment inheritance. */
export function ensureHostId(env: NodeJS.ProcessEnv = process.env): string {
  const hostId = resolveHostId(env);
  if (!env.MONAD_HOST_ID?.trim()) env.MONAD_HOST_ID = hostId;
  return hostId;
}
