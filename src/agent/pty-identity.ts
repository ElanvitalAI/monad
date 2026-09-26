import { basename } from 'node:path';

const CHAIN_ORIGIN_ENV = 'ELANOUS_PTY_CHAIN_ORIGIN';

/** PTY identity inherited by a process running inside a PTY. */
export function getCurrentPtyId(): string | undefined {
  return process.env.ELANOUS_PTY_ID || undefined;
}

/** Parent PTY identity, when the spawning path has propagated it. */
export function getParentPtyId(): string | undefined {
  return process.env.ELANOUS_PARENT_PTY_ID || undefined;
}

/** Human-readable execution-chain origin, if an ancestor supplied one. */
export function getPtyChainOrigin(): string | undefined {
  return process.env[CHAIN_ORIGIN_ENV]?.trim() || undefined;
}

function currentProcessOrigin(): string {
  return basename(process.cwd()) || process.cwd();
}

/** Environment for a child PTY process. The new PTY is always its own identity. */
export function childPtyIdentityEnv(childPtyId: string): Record<string, string> {
  const parentPtyId = getCurrentPtyId();
  const inheritedOrigin = getPtyChainOrigin();
  return {
    ELANOUS_PTY_ID: childPtyId,
    ...(parentPtyId ? { ELANOUS_PARENT_PTY_ID: parentPtyId } : {}),
    [CHAIN_ORIGIN_ENV]: inheritedOrigin ?? currentProcessOrigin(),
  };
}

/**
 * Merge child PTY identity into an inherited base env (e.g. a copy of `process.env`).
 *
 * A plain spread cannot express deletion: when the current process has no `ELANOUS_PTY_ID`,
 * `childPtyIdentityEnv` legitimately omits `ELANOUS_PARENT_PTY_ID`, but a stale value carried
 * over from the base env would silently survive the merge and mis-attribute the child's parent.
 * So we strip all identity keys from the base first, then apply the freshly derived identity.
 */
export function withChildPtyIdentity(
  baseEnv: Record<string, string>,
  childPtyId: string,
): Record<string, string> {
  const {
    ELANOUS_PTY_ID: _pty,
    ELANOUS_PARENT_PTY_ID: _parent,
    ELANOUS_PTY_CHAIN_DEPTH: _legacyChainDepth,
    [CHAIN_ORIGIN_ENV]: _origin,
    ...rest
  } = baseEnv;
  return { ...rest, ...childPtyIdentityEnv(childPtyId) };
}
