import { afterEach, describe, expect, test } from 'bun:test';
import { childPtyIdentityEnv, withChildPtyIdentity } from './pty-identity.js';

const identityKeys = [
  'MONAD_PTY_ID',
  'MONAD_PARENT_PTY_ID',
  'MONAD_PTY_CHAIN_ORIGIN',
] as const;

const originalEnv = Object.fromEntries(identityKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of identityKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('PTY execution-chain identity', () => {
  test('headless parent starts a human-readable origin and first child hop without a parent PTY id', () => {
    delete process.env.MONAD_PTY_ID;
    delete process.env.MONAD_PARENT_PTY_ID;
    delete process.env.MONAD_PTY_CHAIN_ORIGIN;

    const env = childPtyIdentityEnv('pty-child');

    expect(env.MONAD_PTY_ID).toBe('pty-child');
    expect(env.MONAD_PARENT_PTY_ID).toBeUndefined();
    expect(env.MONAD_PTY_CHAIN_ORIGIN).toBe(process.cwd().split('/').at(-1) ?? process.cwd());
  });

  test('inherited execution chain keeps its origin and increments depth independently of PTY ancestry', () => {
    delete process.env.MONAD_PTY_ID;
    delete process.env.MONAD_PARENT_PTY_ID;
    process.env.MONAD_PTY_CHAIN_ORIGIN = 'monad-agent.worktrees/feature-pty';

    const env = childPtyIdentityEnv('pty-headless-child');

    expect(env).toMatchObject({
      MONAD_PTY_ID: 'pty-headless-child',
      MONAD_PTY_CHAIN_ORIGIN: 'monad-agent.worktrees/feature-pty',
    });
    expect(env.MONAD_PARENT_PTY_ID).toBeUndefined();
  });

  test('PTY parent remains a separate edge while the execution chain advances', () => {
    process.env.MONAD_PTY_ID = 'pty-parent';
    process.env.MONAD_PTY_CHAIN_ORIGIN = 'workspace';

    expect(childPtyIdentityEnv('pty-child')).toEqual({
      MONAD_PTY_ID: 'pty-child',
      MONAD_PARENT_PTY_ID: 'pty-parent',
      MONAD_PTY_CHAIN_ORIGIN: 'workspace',
    });
  });

  test('merge removes stale execution-chain identity before deriving fresh values', () => {
    delete process.env.MONAD_PTY_ID;
    delete process.env.MONAD_PTY_CHAIN_ORIGIN;

    const env = withChildPtyIdentity({
      KEEP: 'yes',
      MONAD_PTY_ID: 'stale-pty',
      MONAD_PARENT_PTY_ID: 'stale-parent',
      MONAD_PTY_CHAIN_ORIGIN: 'stale-origin',
    }, 'pty-child');

    expect(env.KEEP).toBe('yes');
    expect(env.MONAD_PTY_ID).toBe('pty-child');
    expect(env.MONAD_PARENT_PTY_ID).toBeUndefined();
    expect(env.MONAD_PTY_CHAIN_ORIGIN).toBe(process.cwd().split('/').at(-1) ?? process.cwd());
  });
});
