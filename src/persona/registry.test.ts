import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonaRegistry } from './registry.js';

describe('PersonaRegistry browserPort preservation', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('returns the loader-produced browserPort without registry-specific handling', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-registry-browser-port-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'remote.yaml'), 'personaId: remote\ndisplayName: Remote\nbrowserPort: 9333\n');

    const registry = new PersonaRegistry();
    const result = await registry.loadDir(dir);

    expect(result.errors).toEqual([]);
    expect(registry.get('remote')).toEqual({ personaId: 'remote', displayName: 'Remote', browserPort: 9333 });
  });
});
