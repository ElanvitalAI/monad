// Test: src/persona/registry.ts
//
// Uses a real temp directory + real fs ops (CLAUDE.md test strategy:
// integration when verifying file I/O behavior).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonaRegistry } from '../../src/persona/registry.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'persona-registry-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeYaml(filename: string, contents: string): Promise<string> {
  const p = join(dir, filename);
  await writeFile(p, contents, 'utf8');
  return p;
}

describe('PersonaRegistry.loadDir', () => {
  test('loads all *.yaml · skips files starting with _', async () => {
    await writeYaml('sage.yaml', 'personaId: sage\ndisplayName: Sage');
    await writeYaml('contrarian.yml', 'personaId: contrarian\ndisplayName: Contrarian');
    await writeYaml('_company.yaml', 'companyId: foo');
    await writeYaml('readme.md', '# notes');
    const r = new PersonaRegistry();
    const result = await r.loadDir(dir);
    expect(result.profiles.size).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(r.has('sage')).toBe(true);
    expect(r.has('contrarian')).toBe(true);
    expect(r.size()).toBe(2);
  });

  test('accumulates errors per file but continues', async () => {
    await writeYaml('good.yaml', 'personaId: good\ndisplayName: Good');
    await writeYaml('bad.yaml', 'displayName: NoId');  // missing personaId
    const r = new PersonaRegistry();
    const result = await r.loadDir(dir);
    expect(result.profiles.size).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('invalid-shape');
    expect(r.has('good')).toBe(true);
  });

  test('non-existent dir → io error in result', async () => {
    const r = new PersonaRegistry();
    const result = await r.loadDir('/no-such-dir-xyz-123');
    expect(result.profiles.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('io');
  });

  test('reloadAll re-scans from prior dirs', async () => {
    await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    expect(r.size()).toBe(1);

    await writeYaml('b.yaml', 'personaId: b\ndisplayName: B');
    const result = await r.reloadAll();
    expect(result.profiles.size).toBe(2);
    expect(r.has('b')).toBe(true);
  });

  test('emits load-dir event', async () => {
    await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    const r = new PersonaRegistry();
    const events: any[] = [];
    r.on((e) => events.push(e));
    await r.loadDir(dir);
    expect(events.find((e) => e.kind === 'load-dir')).toBeDefined();
  });
});

describe('PersonaRegistry.reloadFile', () => {
  test('upserts a single file', async () => {
    const p = await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    expect(r.get('a')?.displayName).toBe('A');

    await writeFile(p, 'personaId: a\ndisplayName: A2', 'utf8');
    const updated = await r.reloadFile(p);
    expect(updated?.displayName).toBe('A2');
    expect(r.get('a')?.displayName).toBe('A2');
  });

  test('reload to a new personaId drops the old entry', async () => {
    const p = await writeYaml('a.yaml', 'personaId: old\ndisplayName: O');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    expect(r.has('old')).toBe(true);

    await writeFile(p, 'personaId: renamed\ndisplayName: R', 'utf8');
    await r.reloadFile(p);
    expect(r.has('old')).toBe(false);
    expect(r.has('renamed')).toBe(true);
  });

  test('reload of missing file drops prior entry', async () => {
    const p = await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    await rm(p);
    const result = await r.reloadFile(p);
    expect(result).toBeNull();
    expect(r.has('a')).toBe(false);
  });

  test('reload non-yaml extension → null, no change', async () => {
    const p = await writeYaml('a.txt', 'whatever');
    const r = new PersonaRegistry();
    const result = await r.reloadFile(p);
    expect(result).toBeNull();
  });
});

describe('PersonaRegistry list / get / has', () => {
  test('list returns inserted profiles', async () => {
    await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    await writeYaml('b.yaml', 'personaId: b\ndisplayName: B');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    const ids = r.list().map((p) => p.personaId).sort();
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('PersonaRegistry watch lifecycle', () => {
  test('startWatch / stopWatch are idempotent', async () => {
    await writeYaml('a.yaml', 'personaId: a\ndisplayName: A');
    const r = new PersonaRegistry();
    await r.loadDir(dir);
    r.startWatch();
    r.startWatch();  // second call no-op
    r.stopWatch();
    r.stopWatch();   // second call no-op
    // No assertion — just verifying no throw.
    expect(r.size()).toBe(1);
  });
});
