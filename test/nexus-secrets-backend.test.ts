// NEXUS · SecretBackend abstraction tests (Phase N-3.5 PR σ)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fileBackend,
  readSecretsFileRaw,
  writeSecretsFileRaw,
} from '../src/nexus/config/secrets/file-backend.js';
import {
  registerBackend,
  getBackend,
  listBackendIds,
  currentBackend,
  currentBackendId,
  useBackend,
  selectBackendFromConfig,
  resetBackendRegistry,
} from '../src/nexus/config/secrets/registry.js';
import {
  getSecret,
  setSecret,
  deleteSecret,
  listSecretIds,
  getSecretAsync,
  setSecretAsync,
  deleteSecretAsync,
  listSecretIdsAsync,
} from '../src/nexus/config/secrets/index.js';
import type { SecretBackend, SecretBackendId } from '../src/nexus/config/secrets/types.js';
import { secretsPath } from '../src/nexus/config/paths.js';
import {
  patchUserConfig,
  writeSwitchValue,
} from '../src/nexus/config/user-config.js';
import { clearSwitchRegistry } from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-n35-secret-'));
  setMonadConfigDir(tmpRoot);
  resetBackendRegistry();
  clearSwitchRegistry();
  reloadAllBuiltins();
});
afterEach(() => {
  resetMonadConfigDir();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  resetBackendRegistry();
  clearSwitchRegistry();
});

// ---------------------------------------------------------------------------
// FileBackend (PR μ behavior preserved)
// ---------------------------------------------------------------------------

describe('FileBackend · async API', () => {
  test('set / get / list / delete round-trip', async () => {
    expect(await fileBackend.list()).toEqual([]);
    await fileBackend.set('a', 'AAA');
    await fileBackend.set('b', 'BBB');
    expect((await fileBackend.list()).sort()).toEqual(['a', 'b']);
    expect(await fileBackend.get('a')).toBe('AAA');
    expect(await fileBackend.get('missing')).toBeUndefined();
    expect(await fileBackend.delete('a')).toBe(true);
    expect(await fileBackend.delete('a')).toBe(false);
    expect(await fileBackend.list()).toEqual(['b']);
  });

  test('writes 0o600 mode', async () => {
    await fileBackend.set('k', 'v');
    expect(existsSync(secretsPath())).toBe(true);
    const stats = statSync(secretsPath());
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test('isAvailable always ok', async () => {
    expect(await fileBackend.isAvailable()).toEqual({ ok: true });
  });

  test('syncReadable matches async result', async () => {
    await fileBackend.set('s1', 'V1');
    expect(fileBackend.syncReadable!.getSync('s1')).toBe('V1');
    expect(fileBackend.syncReadable!.listSync()).toEqual(['s1']);
  });

  test('readSecretsFileRaw / writeSecretsFileRaw round-trip', () => {
    writeSecretsFileRaw({ version: 1, secrets: { x: 'X', y: 'Y' } });
    const r = readSecretsFileRaw();
    expect(r.secrets).toEqual({ x: 'X', y: 'Y' });
  });
});

// ---------------------------------------------------------------------------
// Backend registry
// ---------------------------------------------------------------------------

describe('BackendRegistry', () => {
  test('file backend always registered as default', () => {
    expect(listBackendIds()).toEqual(['file']);
    expect(currentBackendId()).toBe('file');
    expect(currentBackend().id).toBe('file');
  });

  test('registerBackend adds custom backend', () => {
    const dummy = makeFakeBackend('aws');
    registerBackend(dummy);
    expect(listBackendIds().sort()).toEqual(['aws', 'file']);
    expect(getBackend('aws')).toBe(dummy);
  });

  test('useBackend switches active', () => {
    registerBackend(makeFakeBackend('keychain'));
    useBackend('keychain');
    expect(currentBackendId()).toBe('keychain');
  });

  test('useBackend throws for unregistered id', () => {
    expect(() => useBackend('aws')).toThrow(/not registered/);
  });

  test('resetBackendRegistry restores file-only', () => {
    registerBackend(makeFakeBackend('aws'));
    useBackend('aws');
    resetBackendRegistry();
    expect(listBackendIds()).toEqual(['file']);
    expect(currentBackendId()).toBe('file');
  });
});

describe('selectBackendFromConfig', () => {
  test('default → file when switch unset', () => {
    expect(selectBackendFromConfig()).toBe('file');
    expect(currentBackendId()).toBe('file');
  });

  test('switches to registered backend declared in UserConfig', () => {
    registerBackend(makeFakeBackend('keychain'));
    patchUserConfig((c) => writeSwitchValue(c, 'global.secrets.backend', 'keychain'));
    expect(selectBackendFromConfig()).toBe('keychain');
    expect(currentBackendId()).toBe('keychain');
  });

  test('falls back to file when configured backend unregistered', () => {
    patchUserConfig((c) => writeSwitchValue(c, 'global.secrets.backend', 'aws'));
    // No AWS backend registered → fallback
    expect(selectBackendFromConfig()).toBe('file');
    expect(currentBackendId()).toBe('file');
  });

  test('falls back to file for unknown enum string', () => {
    patchUserConfig((c) => writeSwitchValue(c, 'global.secrets.backend', 'mystery'));
    expect(selectBackendFromConfig()).toBe('file');
  });
});

// ---------------------------------------------------------------------------
// Sync facade — file only · cloud throws
// ---------------------------------------------------------------------------

describe('Sync API · current backend dispatch', () => {
  test('file backend supports getSecret / setSecret / deleteSecret / listSecretIds', () => {
    setSecret('k', 'V');
    expect(getSecret('k')).toBe('V');
    expect(listSecretIds()).toEqual(['k']);
    expect(deleteSecret('k')).toBe(true);
    expect(deleteSecret('k')).toBe(false);
  });

  test('non-sync backend throws on getSecret', () => {
    registerBackend(makeFakeBackend('aws', { withSync: false }));
    useBackend('aws');
    expect(() => getSecret('k')).toThrow(/does not support sync access/);
    expect(() => listSecretIds()).toThrow(/does not support sync access/);
    expect(() => deleteSecret('k')).toThrow(/does not support sync access/);
  });
});

// ---------------------------------------------------------------------------
// Async API · works on every backend
// ---------------------------------------------------------------------------

describe('Async API · current backend dispatch', () => {
  test('file backend round-trip via async API', async () => {
    await setSecretAsync('a', 'AAA');
    expect(await getSecretAsync('a')).toBe('AAA');
    expect(await listSecretIdsAsync()).toEqual(['a']);
    expect(await deleteSecretAsync('a')).toBe(true);
  });

  test('async API works against fake backend (no sync support)', async () => {
    const back = makeFakeBackend('gcp', { withSync: false });
    registerBackend(back);
    useBackend('gcp');
    await setSecretAsync('k', 'CLOUD-VAL');
    expect(await getSecretAsync('k')).toBe('CLOUD-VAL');
    expect(await listSecretIdsAsync()).toEqual(['k']);
    expect(await deleteSecretAsync('k')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeBackend(id: SecretBackendId, opts: { withSync?: boolean } = {}): SecretBackend {
  const store = new Map<string, string>();
  const back: SecretBackend = {
    id,
    async get(k) { return store.get(k); },
    async set(k, v) { store.set(k, v); },
    async delete(k) { return store.delete(k); },
    async list() { return [...store.keys()]; },
    async isAvailable() { return { ok: true }; },
  };
  if (opts.withSync !== false && opts.withSync !== undefined) {
    back.syncReadable = {
      getSync: (k) => store.get(k),
      listSync: () => [...store.keys()],
    };
  }
  return back;
}

// ---------------------------------------------------------------------------
// SwitchRegistry switch presence
// ---------------------------------------------------------------------------

describe('global.secrets.backend SwitchRegistry switch', () => {
  test('switch is registered with 5 enum values', async () => {
    const { getSwitch } = await import('../src/nexus/config/switch-registry.js');
    const sw = getSwitch('global.secrets.backend');
    expect(sw).toBeDefined();
    expect(sw!.kind).toBe('enum');
    expect(sw!.default).toBe('file');
    expect(sw!.enumValues?.map((e) => e.value).sort()).toEqual(['1password', 'aws', 'file', 'gcp', 'keychain']);
    expect(sw!.hotApplicable).toBe(false);
    expect(sw!.pwaPreferred).toBe(true);
  });

  test('switch validate accepts every backend id', async () => {
    const { getSwitch } = await import('../src/nexus/config/switch-registry.js');
    const sw = getSwitch('global.secrets.backend')!;
    for (const id of ['file', 'keychain', 'aws', 'gcp', '1password']) {
      expect(sw.validate?.(id)).toBeNull();
    }
    expect(sw.validate?.('mystery')).not.toBeNull();
  });
});
