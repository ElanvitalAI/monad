import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetGlobalPersonaRegistryForTest,
  awaitGlobalPersonaLoad,
  getGlobalPersonaRegistry,
  setGlobalPersonaRegistryDir,
} from './global-registry.js';

let dir: string;

beforeEach(() => {
  _resetGlobalPersonaRegistryForTest();
  dir = mkdtempSync(join(tmpdir(), 'global-persona-browser-port-'));
  setGlobalPersonaRegistryDir(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  _resetGlobalPersonaRegistryForTest();
});

describe('global persona registry browserPort preservation', () => {
  test('exposes the loaded profile to existing global lookup callers', async () => {
    writeFileSync(join(dir, 'remote.yaml'), 'personaId: remote\ndisplayName: Remote\nbrowserPort: 9333\n');

    await awaitGlobalPersonaLoad();

    expect(getGlobalPersonaRegistry().get('remote')).toEqual({
      personaId: 'remote',
      displayName: 'Remote',
      browserPort: 9333,
    });
  });
});
