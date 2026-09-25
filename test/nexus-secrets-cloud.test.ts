// NEXUS · cloud secret backend tests (Phase N-3.5 PR υ)
//
// Each backend is tested via injected stubs:
//   - Keychain + 1Password — stub `runCli` (CLI-driven backends)
//   - AWS + GCP — stub `clientFactory` (SDK-driven backends)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeychainBackend, deleteKeychainIndex } from '../src/nexus/config/secrets/keychain-backend.js';
import { createOnePasswordBackend } from '../src/nexus/config/secrets/onepassword-backend.js';
import { createAwsBackend } from '../src/nexus/config/secrets/aws-backend.js';
import { createGcpBackend } from '../src/nexus/config/secrets/gcp-backend.js';
import { makeStubRunCli } from '../src/nexus/config/secrets/cli-helper.js';
import {
  resetBackendRegistry,
  listBackendIds,
  useBackend,
  currentBackend,
} from '../src/nexus/config/secrets/registry.js';
import { runNexus, type RunNexusHandle } from '../src/nexus/index.js';
import { makeTestSpawnBackend } from '../src/nexus/supervisor/spawn.js';
import { clearSwitchRegistry } from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { patchUserConfig, writeSwitchValue } from '../src/nexus/config/user-config.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-n35-cloud-'));
  setMonadConfigDir(tmpRoot);
  process.env.MONAD_NEXUS_DIR = tmpRoot;
  resetBackendRegistry();
  clearSwitchRegistry();
  reloadAllBuiltins();
});
afterEach(() => {
  resetMonadConfigDir();
  delete process.env.MONAD_NEXUS_DIR;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  resetBackendRegistry();
  clearSwitchRegistry();
});

// ---------------------------------------------------------------------------
// KeychainBackend — stubbed `security` CLI
// ---------------------------------------------------------------------------

describe('KeychainBackend (stubbed security CLI)', () => {
  function makeKeychain(stub: Record<string, (cmd: string[]) => { exitCode: number; stdout?: string; stderr?: string }>): ReturnType<typeof createKeychainBackend> {
    return createKeychainBackend({
      runCliImpl: makeStubRunCli(Object.fromEntries(Object.entries(stub).map(([k, fn]) => [k, async (cmd) => {
        const r = fn(cmd);
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode };
      }])) as Record<string, (cmd: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>>),
      indexPath: join(tmpRoot, 'kc-index.json'),
      platformOverride: 'darwin',
    });
  }

  test('isAvailable=false on non-macOS', async () => {
    const back = createKeychainBackend({
      runCliImpl: makeStubRunCli({ security: () => ({ stdout: '', stderr: '', exitCode: 0 }) }),
      platformOverride: 'linux',
    });
    expect((await back.isAvailable()).ok).toBe(false);
  });

  test('isAvailable ok=true when security CLI present + macOS', async () => {
    const back = makeKeychain({ security: () => ({ exitCode: 0 }) });
    expect((await back.isAvailable()).ok).toBe(true);
  });

  test('get returns stdout (trim trailing newline)', async () => {
    const back = makeKeychain({
      security: (cmd) => {
        if (cmd.includes('find-generic-password')) return { exitCode: 0, stdout: 'TOKEN-X\n' };
        return { exitCode: 1 };
      },
    });
    expect(await back.get('id')).toBe('TOKEN-X');
  });

  test('get returns undefined when CLI exits non-zero', async () => {
    const back = makeKeychain({
      security: (cmd) => cmd.includes('find-generic-password') ? { exitCode: 44 } : { exitCode: 0 },
    });
    expect(await back.get('missing')).toBeUndefined();
  });

  test('set updates index sidecar on success', async () => {
    deleteKeychainIndex({ indexPath: join(tmpRoot, 'kc-index.json') });
    const back = makeKeychain({
      security: (cmd) => cmd.includes('add-generic-password') ? { exitCode: 0 } : { exitCode: 0 },
    });
    await back.set('alpha', 'A');
    await back.set('beta', 'B');
    expect((await back.list()).sort()).toEqual(['alpha', 'beta']);
  });

  test('set throws on CLI failure', async () => {
    const back = makeKeychain({
      security: () => ({ exitCode: 1, stderr: 'permission denied' }),
    });
    await expect(back.set('id', 'V')).rejects.toThrow(/keychain set failed/);
  });

  test('delete removes from index when CLI ok', async () => {
    const back = makeKeychain({
      security: (cmd) => cmd[0] === 'security' && cmd[1] === 'add-generic-password' ? { exitCode: 0 }
        : cmd[1] === 'delete-generic-password' ? { exitCode: 0 } : { exitCode: 1 },
    });
    await back.set('a', 'A');
    expect(await back.list()).toEqual(['a']);
    expect(await back.delete('a')).toBe(true);
    expect(await back.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OnePasswordBackend — stubbed `op` CLI
// ---------------------------------------------------------------------------

describe('OnePasswordBackend (stubbed op CLI)', () => {
  function makeOp(stub: Record<string, (cmd: string[]) => { exitCode: number; stdout?: string; stderr?: string }>) {
    return createOnePasswordBackend({
      vault: 'Personal',
      runCliImpl: makeStubRunCli(Object.fromEntries(Object.entries(stub).map(([k, fn]) => [k, async (cmd) => {
        const r = fn(cmd);
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode };
      }])) as Record<string, (cmd: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>>),
    });
  }

  test('isAvailable=false when vault empty', async () => {
    const back = createOnePasswordBackend({ vault: '' });
    expect((await back.isAvailable()).ok).toBe(false);
  });

  test('isAvailable ok with op installed', async () => {
    const back = makeOp({ op: (cmd) => cmd.includes('--version') ? { exitCode: 0, stdout: '2.30.0' } : { exitCode: 0 } });
    expect((await back.isAvailable()).ok).toBe(true);
  });

  test('isAvailable=false when op CLI missing', async () => {
    const back = makeOp({ op: () => ({ exitCode: 127, stderr: 'op: command not found' }) });
    const r = await back.isAvailable();
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('op');
  });

  test('get reads via op://vault/id/credential', async () => {
    let captured: string[] = [];
    const back = makeOp({
      op: (cmd) => {
        if (cmd[1] === 'read') {
          captured = cmd;
          return { exitCode: 0, stdout: 'TOKEN-Y\n' };
        }
        return { exitCode: 1 };
      },
    });
    expect(await back.get('mySecret')).toBe('TOKEN-Y');
    expect(captured).toContain('op://Personal/mySecret/credential');
  });

  test('set tries edit first, falls back to create', async () => {
    let calls: string[][] = [];
    const back = makeOp({
      op: (cmd) => {
        calls.push(cmd);
        if (cmd[1] === 'item' && cmd[2] === 'edit') return { exitCode: 1, stderr: 'not found' };
        if (cmd[1] === 'item' && cmd[2] === 'create') return { exitCode: 0 };
        return { exitCode: 1 };
      },
    });
    await back.set('newId', 'NEW-VAL');
    expect(calls.length).toBe(2);
    expect(calls[0][2]).toBe('edit');
    expect(calls[1][2]).toBe('create');
  });

  test('list parses JSON titles', async () => {
    const back = makeOp({
      op: (cmd) => cmd.includes('list')
        ? { exitCode: 0, stdout: JSON.stringify([{ title: 'a' }, { title: 'b' }]) }
        : { exitCode: 0 },
    });
    expect((await back.list()).sort()).toEqual(['a', 'b']);
  });

  test('delete returns true on exit 0', async () => {
    const back = makeOp({ op: (cmd) => cmd[2] === 'delete' ? { exitCode: 0 } : { exitCode: 0 } });
    expect(await back.delete('id')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AWS Secrets Manager backend — stubbed client
// ---------------------------------------------------------------------------

describe('AwsBackend (stubbed SDK client)', () => {
  interface FakeAwsClient {
    sent: { name: string; input: Record<string, unknown> }[];
    secrets: Map<string, string>;
    nextError?: { name?: string; __type?: string };
    send(cmd: { name: string; input: Record<string, unknown> }): Promise<unknown>;
  }
  function makeFakeClient(): FakeAwsClient {
    const client: FakeAwsClient = {
      sent: [],
      secrets: new Map(),
      async send(cmd) {
        client.sent.push(cmd);
        if (client.nextError) { const e = client.nextError; client.nextError = undefined; throw e; }
        // Simulate by inspecting cmd.name (test stub doesn't actually use sdk)
        return {};
      },
    };
    return client;
  }

  test('isAvailable=false without region', async () => {
    const back = createAwsBackend({});
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    expect((await back.isAvailable()).ok).toBe(false);
  });

  test('isAvailable ok with region + clientFactory', async () => {
    const back = createAwsBackend({ region: 'us-east-1', clientFactory: () => makeFakeClient() });
    expect((await back.isAvailable()).ok).toBe(true);
  });

  test('list filters by prefix', async () => {
    const fake = makeFakeClient();
    fake.send = async () => ({
      SecretList: [
        { Name: 'monad/keep-1' },
        { Name: 'monad/keep-2' },
        { Name: 'unrelated/skip' },
      ],
    });
    const back = createAwsBackend({ region: 'us-east-1', secretPrefix: 'monad/', clientFactory: () => fake });
    expect((await back.list()).sort()).toEqual(['keep-1', 'keep-2']);
  });

  test('get returns undefined on ResourceNotFoundException', async () => {
    const fake = makeFakeClient();
    fake.send = async () => { const e = { name: 'ResourceNotFoundException' }; throw e; };
    const back = createAwsBackend({ region: 'us-east-1', clientFactory: () => fake });
    expect(await back.get('missing')).toBeUndefined();
  });

  test('delete returns false on ResourceNotFoundException', async () => {
    const fake = makeFakeClient();
    fake.send = async () => { throw { name: 'ResourceNotFoundException' }; };
    const back = createAwsBackend({ region: 'us-east-1', clientFactory: () => fake });
    expect(await back.delete('missing')).toBe(false);
  });

  test('set tries Update first, falls back to Create on NotFound', async () => {
    const fake = makeFakeClient();
    let callCount = 0;
    fake.send = async () => {
      callCount += 1;
      if (callCount === 1) throw { name: 'ResourceNotFoundException' };
      return {};
    };
    const back = createAwsBackend({ region: 'us-east-1', clientFactory: () => fake });
    await back.set('newSecret', 'V');
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GCP Secret Manager backend — stubbed client
// ---------------------------------------------------------------------------

describe('GcpBackend (stubbed SDK client)', () => {
  test('isAvailable=false without projectId', async () => {
    const back = createGcpBackend({});
    expect((await back.isAvailable()).ok).toBe(false);
  });

  test('get returns undefined on NOT_FOUND (code=5)', async () => {
    const back = createGcpBackend({
      projectId: 'p',
      clientFactory: () => ({
        accessSecretVersion: async () => { throw { code: 5 }; },
        createSecret: async () => ({}),
        addSecretVersion: async () => ({}),
        deleteSecret: async () => ({}),
        listSecrets: async () => [[]],
      }),
    });
    expect(await back.get('missing')).toBeUndefined();
  });

  test('get returns decoded payload', async () => {
    const back = createGcpBackend({
      projectId: 'p',
      clientFactory: () => ({
        accessSecretVersion: async () => [{ payload: { data: new TextEncoder().encode('GCP-VAL') } }],
        createSecret: async () => ({}),
        addSecretVersion: async () => ({}),
        deleteSecret: async () => ({}),
        listSecrets: async () => [[]],
      }),
    });
    expect(await back.get('id')).toBe('GCP-VAL');
  });

  test('set creates secret then adds version (idempotent on ALREADY_EXISTS)', async () => {
    const calls: string[] = [];
    const back = createGcpBackend({
      projectId: 'p',
      clientFactory: () => ({
        accessSecretVersion: async () => [{}],
        createSecret: async () => { calls.push('create'); throw { code: 6 }; }, // ALREADY_EXISTS
        addSecretVersion: async () => { calls.push('addVersion'); return {}; },
        deleteSecret: async () => ({}),
        listSecrets: async () => [[]],
      }),
    });
    await back.set('id', 'V');
    expect(calls).toEqual(['create', 'addVersion']);
  });

  test('list extracts last path segment as id', async () => {
    const back = createGcpBackend({
      projectId: 'p',
      clientFactory: () => ({
        accessSecretVersion: async () => [{}],
        createSecret: async () => ({}),
        addSecretVersion: async () => ({}),
        deleteSecret: async () => ({}),
        listSecrets: async () => [[
          { name: 'projects/p/secrets/alpha' },
          { name: 'projects/p/secrets/beta' },
        ]],
      }),
    });
    expect((await back.list()).sort()).toEqual(['alpha', 'beta']);
  });

  test('delete returns false on NOT_FOUND', async () => {
    const back = createGcpBackend({
      projectId: 'p',
      clientFactory: () => ({
        accessSecretVersion: async () => [{}],
        createSecret: async () => ({}),
        addSecretVersion: async () => ({}),
        deleteSecret: async () => { throw { code: 5 }; },
        listSecrets: async () => [[]],
      }),
    });
    expect(await back.delete('missing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runNexus boot — registers all 4 cloud backends + selects via switch
// ---------------------------------------------------------------------------

describe('runNexus boot · cloud backend registration', () => {
  let handle: RunNexusHandle | undefined;
  afterEach(() => { handle?.release(); handle = undefined; });

  test('default boot registers file + 4 cloud backends', async () => {
    handle = await runNexus({
      detachForTesting: true,
      supervisorSpawnBackend: makeTestSpawnBackend(),
    });
    expect(listBackendIds().sort()).toEqual(['1password', 'aws', 'file', 'gcp', 'keychain']);
  });

  test('global.secrets.backend=keychain → useBackend keychain', async () => {
    patchUserConfig((c) => writeSwitchValue(c, 'global.secrets.backend', 'keychain'));
    handle = await runNexus({
      detachForTesting: true,
      supervisorSpawnBackend: makeTestSpawnBackend(),
    });
    expect(currentBackend().id).toBe('keychain');
  });

  test('global.secrets.backend=aws → useBackend aws', async () => {
    patchUserConfig((c) => {
      writeSwitchValue(c, 'global.secrets.backend', 'aws');
      writeSwitchValue(c, 'global.secrets.aws.region', 'us-west-2');
    });
    handle = await runNexus({
      detachForTesting: true,
      supervisorSpawnBackend: makeTestSpawnBackend(),
    });
    expect(currentBackend().id).toBe('aws');
  });

  test('useBackend throws for unregistered cloud variant when register skipped', () => {
    // (without runNexus, just registry)
    resetBackendRegistry();
    expect(() => useBackend('aws')).toThrow();
  });
});
