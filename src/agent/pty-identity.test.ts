import { afterEach, describe, expect, test } from 'bun:test';
import { childPtyIdentityEnv, withChildPtyIdentity } from './pty-identity.js';

const identityKeys = [
  'ELANOUS_PTY_ID',
  'ELANOUS_PARENT_PTY_ID',
  'ELANOUS_PTY_CHAIN_ORIGIN',
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
    delete process.env.ELANOUS_PTY_ID;
    delete process.env.ELANOUS_PARENT_PTY_ID;
    delete process.env.ELANOUS_PTY_CHAIN_ORIGIN;

    const env = childPtyIdentityEnv('pty-child');

    expect(env.ELANOUS_PTY_ID).toBe('pty-child');
    expect(env.ELANOUS_PARENT_PTY_ID).toBeUndefined();
    expect(env.ELANOUS_PTY_CHAIN_ORIGIN).toBe(process.cwd().split('/').at(-1) ?? process.cwd());
  });

  test('inherited execution chain keeps its origin and increments depth independently of PTY ancestry', () => {
    delete process.env.ELANOUS_PTY_ID;
    delete process.env.ELANOUS_PARENT_PTY_ID;
    process.env.ELANOUS_PTY_CHAIN_ORIGIN = 'monad-agent.worktrees/feature-pty';

    const env = childPtyIdentityEnv('pty-headless-child');

    expect(env).toMatchObject({
      ELANOUS_PTY_ID: 'pty-headless-child',
      ELANOUS_PTY_CHAIN_ORIGIN: 'monad-agent.worktrees/feature-pty',
    });
    expect(env.ELANOUS_PARENT_PTY_ID).toBeUndefined();
  });

  test('PTY parent remains a separate edge while the execution chain advances', () => {
    process.env.ELANOUS_PTY_ID = 'pty-parent';
    process.env.ELANOUS_PTY_CHAIN_ORIGIN = 'workspace';

    expect(childPtyIdentityEnv('pty-child')).toEqual({
      ELANOUS_PTY_ID: 'pty-child',
      ELANOUS_PARENT_PTY_ID: 'pty-parent',
      ELANOUS_PTY_CHAIN_ORIGIN: 'workspace',
    });
  });

  test('merge removes stale execution-chain identity before deriving fresh values', () => {
    delete process.env.ELANOUS_PTY_ID;
    delete process.env.ELANOUS_PTY_CHAIN_ORIGIN;

    const env = withChildPtyIdentity({
      KEEP: 'yes',
      ELANOUS_PTY_ID: 'stale-pty',
      ELANOUS_PARENT_PTY_ID: 'stale-parent',
      ELANOUS_PTY_CHAIN_ORIGIN: 'stale-origin',
    }, 'pty-child');

    expect(env.KEEP).toBe('yes');
    expect(env.ELANOUS_PTY_ID).toBe('pty-child');
    expect(env.ELANOUS_PARENT_PTY_ID).toBeUndefined();
    expect(env.ELANOUS_PTY_CHAIN_ORIGIN).toBe(process.cwd().split('/').at(-1) ?? process.cwd());
  });
});
