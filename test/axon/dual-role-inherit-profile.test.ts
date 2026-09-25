// AXON P6.3 — DualRoleManager.inheritProfile + listAsSidebarStubs tests.
//
// inheritProfile:
//  - derives model/permissionMode from parent ClientSessionRecord
//  - filters env via AXON_CHILD_ENV_BLOCKLIST + AXON_CHILD_ENV_BLOCK_PREFIXES
//  - echoes parent lastSeenAt
//  - returns env-only profile for unknown parent id
//
// listAsSidebarStubs:
//  - maps ClientSessionRecord with backend-id → AgentKind
//  - maps ServerSessionRecord → 'other'
//  - labels titles correctly
//  - populates meta.namespace

import { afterEach, describe, expect, test } from 'bun:test';
import {
  AXON_CHILD_ENV_BLOCKLIST,
  AXON_CHILD_ENV_BLOCK_PREFIXES,
  DualRoleManager,
  __resetDualRoleManagerForTest,
  backendIdToAgentKind,
  type ClientSessionCreateOpts,
} from '../../src/acp/dual-role-manager.js';
import type { AcpAgent } from '../../src/acp/client.js';

function makeFakeAgent(): AcpAgent {
  return {
    newSession: async () => 'fake-sess',
    prompt: async () => ({ stopReason: 'end_turn' }),
    cancel: async () => {},
    start: async () => {},
    stop: async () => {},
    backendId: 'fake',
    cwd: '',
    env: {},
    log: () => {},
    setPermissionApprover: () => {},
    setQuestionApprover: () => {},
  } as unknown as AcpAgent;
}

afterEach(() => {
  __resetDualRoleManagerForTest();
});

describe('AXON P6.3 — backendIdToAgentKind', () => {
  test('maps canonical backend ids to AgentKind', () => {
    expect(backendIdToAgentKind('claude')).toBe('claude-code');
    expect(backendIdToAgentKind('codex')).toBe('codex');
    expect(backendIdToAgentKind('gemini')).toBe('gemini-cli');
    expect(backendIdToAgentKind('unknown-brand')).toBe('other');
    expect(backendIdToAgentKind('')).toBe('other');
  });
});

describe('AXON P6.3 — inheritProfile env filtering', () => {
  test('strips every blocklist entry from the inherited env', () => {
    const manager = new DualRoleManager();
    const profile = manager.inheritProfile('unknown-id', {
      parentEnv: {
        USER: 'joe',
        HOME: '/home/joe',
        CLAUDECODE: '1',
        MONAD_SESSION_ID: 'abc',
        MONAD_HITL_PORT: '9999',
        PATH: '/usr/bin',
      },
    });
    expect(profile.env).toEqual({
      USER: 'joe',
      HOME: '/home/joe',
      PATH: '/usr/bin',
    });
  });

  test('strips block-prefix entries', () => {
    const manager = new DualRoleManager();
    const profile = manager.inheritProfile('unknown-id', {
      parentEnv: {
        USER: 'joe',
        CLAUDE_CODE_CONFIG: '/some/path',
        CLAUDE_CODE_PLUGIN: 'x',
        CLAUDE_HOME: '/other/home',  // no prefix match — kept
      },
    });
    expect(profile.env).toEqual({
      USER: 'joe',
      CLAUDE_HOME: '/other/home',
    });
  });

  test('ignores undefined env values', () => {
    const manager = new DualRoleManager();
    const profile = manager.inheritProfile('unknown-id', {
      parentEnv: {
        USER: 'joe',
        OPTIONAL_FLAG: undefined as unknown as string,  // simulate unset var
      },
    });
    expect(profile.env!.USER).toBe('joe');
    expect('OPTIONAL_FLAG' in profile.env!).toBe(false);
  });

  test('accepts custom blocklist + block-prefix overrides', () => {
    const manager = new DualRoleManager();
    const profile = manager.inheritProfile('unknown-id', {
      parentEnv: { X: '1', Y: '2', Z_FOO: '3', Z_BAR: '4' },
      envBlocklist: ['Y'],
      envBlockPrefix: ['Z_'],
    });
    expect(profile.env).toEqual({ X: '1' });
  });

  test('AXON_CHILD_ENV_BLOCKLIST + AXON_CHILD_ENV_BLOCK_PREFIXES are non-empty', () => {
    expect(AXON_CHILD_ENV_BLOCKLIST.length).toBeGreaterThan(0);
    expect(AXON_CHILD_ENV_BLOCK_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe('AXON P6.3 — inheritProfile with known parent', () => {
  function registerParent(manager: DualRoleManager, opts: Partial<ClientSessionCreateOpts> = {}) {
    // Bypass acquireAgent by stubbing the factory — test fake AcpAgent
    // never reaches the subprocess path.
    manager.__setAgentFactoryForTest(async () => makeFakeAgent());
    return manager.clientSessionCreate({
      backendId: 'claude',
      cwd: '/tmp/parent-work',
      ...opts,
    } as ClientSessionCreateOpts);
  }

  test('propagates model + permissionMode from parent client record', async () => {
    const manager = new DualRoleManager();
    const parent = await registerParent(manager, { model: 'claude-opus-4-7', permissionMode: 'plan' });
    const profile = manager.inheritProfile(parent.id, { parentEnv: {} });
    expect(profile.model).toBe('claude-opus-4-7');
    expect(profile.permissionMode).toBe('plan');
    expect(profile.lastSeenAt).toBe(parent.lastSeenAt);
  });

  test('omits model when parent was created without it', async () => {
    const manager = new DualRoleManager();
    const parent = await registerParent(manager);
    const profile = manager.inheritProfile(parent.id, { parentEnv: {} });
    expect(profile.model).toBeUndefined();
    expect(profile.permissionMode).toBeUndefined();
  });

  test('resolves parent by raw backend session id (not only namespaced)', async () => {
    const manager = new DualRoleManager();
    const parent = await registerParent(manager, { model: 'sonnet' });
    const profile = manager.inheritProfile(parent.backendSessionId, { parentEnv: {} });
    expect(profile.model).toBe('sonnet');
  });

  test('unknown parent id ⇒ empty profile except env', () => {
    const manager = new DualRoleManager();
    const profile = manager.inheritProfile('nope', { parentEnv: { USER: 'j' } });
    expect(profile.model).toBeUndefined();
    expect(profile.permissionMode).toBeUndefined();
    expect(profile.lastSeenAt).toBeUndefined();
    expect(profile.env).toEqual({ USER: 'j' });
  });
});

describe('AXON P6.3 — listAsSidebarStubs', () => {
  test('empty manager returns empty array', () => {
    const manager = new DualRoleManager();
    expect(manager.listAsSidebarStubs()).toEqual([]);
  });

  test('client session maps backend → agentKind + title', async () => {
    const manager = new DualRoleManager();
    manager.__setAgentFactoryForTest(async () => makeFakeAgent());
    const rec = await manager.clientSessionCreate({ backendId: 'claude', cwd: '/home/me/proj' });
    const stubs = manager.listAsSidebarStubs();
    expect(stubs).toHaveLength(1);
    const s = stubs[0]!;
    expect(s.id).toBe(rec.id);
    expect(s.agentKind).toBe('claude-code');
    expect(s.title).toContain('ACP');
    expect(s.title).toContain('claude');
    expect(s.title).toContain('proj');
    expect(s.isAlive).toBe(true);
    expect(s.lastActivityAt).toBe(rec.lastSeenAt);
    expect((s.meta as any).namespace).toBe('acp-cli');
    expect((s.meta as any).backendId).toBe('claude');
  });

  test('client session with model + permissionMode surfaces them in meta', async () => {
    const manager = new DualRoleManager();
    manager.__setAgentFactoryForTest(async () => makeFakeAgent());
    await manager.clientSessionCreate({
      backendId: 'codex',
      cwd: '/work',
      model: 'o1-pro',
      permissionMode: 'auto',
    });
    const s = manager.listAsSidebarStubs()[0]!;
    expect((s.meta as any).model).toBe('o1-pro');
    expect((s.meta as any).permissionMode).toBe('auto');
    expect(s.agentKind).toBe('codex');
  });

  test('server session maps to "other" kind + server title', () => {
    const manager = new DualRoleManager();
    manager.serverSessionRegister('monad-session-1', '/home/me/srv-proj');
    const stubs = manager.listAsSidebarStubs();
    expect(stubs).toHaveLength(1);
    const s = stubs[0]!;
    expect(s.agentKind).toBe('other');
    expect(s.title).toContain('ACP server');
    expect(s.title).toContain('srv-proj');
    expect((s.meta as any).namespace).toBe('acp-srv');
  });

  test('mixed client + server sessions both appear in the stub list', async () => {
    const manager = new DualRoleManager();
    manager.__setAgentFactoryForTest(async () => makeFakeAgent());
    await manager.clientSessionCreate({ backendId: 'gemini', cwd: '/w' });
    manager.serverSessionRegister('monad-session-7', '/home');
    const stubs = manager.listAsSidebarStubs();
    expect(stubs).toHaveLength(2);
    const kinds = stubs.map(s => s.agentKind).sort();
    expect(kinds).toEqual(['gemini-cli', 'other']);
  });

  test('empty cwd falls back to no basename in title', () => {
    const manager = new DualRoleManager();
    manager.serverSessionRegister('monad-session-9', '');
    const s = manager.listAsSidebarStubs()[0]!;
    expect(s.title).toBe('ACP server');
  });
});
