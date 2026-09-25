import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetGlobalPersonaRegistryForTest,
  awaitGlobalPersonaLoad,
  getGlobalPersonaRegistry,
  loadLayeredPersonaDirs,
  reloadGlobalPersonaRegistry,
  resolveRepositoryPersonaDir,
} from '../src/persona/global-registry.js';
import { wireSprint21Runtime } from '../src/discord/sprint21-runtime.js';
import { PersonaRegistry } from '../src/persona/registry.js';

const dirs: string[] = [];
const originalPersonasDir = process.env.MONAD_PERSONAS_DIR;

async function personaDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function writePersona(dir: string, id: string, displayName: string): Promise<void> {
  await writeFile(join(dir, `${id}.yaml`), `personaId: ${id}\ndisplayName: ${displayName}\n`);
}

function fakeFetch(): typeof fetch {
  return (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
}

afterEach(async () => {
  _resetGlobalPersonaRegistryForTest();
  if (originalPersonasDir === undefined) delete process.env.MONAD_PERSONAS_DIR;
  else process.env.MONAD_PERSONAS_DIR = originalPersonasDir;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('persona store layering', () => {
  test('global singleton loads state-only and repository-only personas', async () => {
    const stateDir = await personaDir('persona-state-');
    await writePersona(stateDir, 'state-only', 'State only');
    process.env.MONAD_PERSONAS_DIR = stateDir;

    const registry = getGlobalPersonaRegistry();
    await awaitGlobalPersonaLoad();

    expect(registry.get('state-only')?.displayName).toBe('State only');
    expect(registry.get('contrarian')).toBeDefined();
  });

  test('repository layer wins duplicate IDs without reporting a duplicate error', async () => {
    const stateDir = await personaDir('persona-state-');
    const repositoryDir = await personaDir('persona-repository-');
    await writePersona(stateDir, 'shared', 'State version');
    await writePersona(repositoryDir, 'shared', 'Repository version');

    const registry = new PersonaRegistry();
    const result = await loadLayeredPersonaDirs(registry, [stateDir, repositoryDir]);

    expect(registry.get('shared')?.displayName).toBe('Repository version');
    expect(result.errors).toEqual([]);
    expect(result.loadedFiles).toContain(join(repositoryDir, 'shared.yaml'));
  });

  test('reload preserves repository precedence and restores state after repository deletion', async () => {
    const stateDir = await personaDir('persona-state-');
    const repositoryDir = await personaDir('persona-repository-');
    const repositoryFile = join(repositoryDir, 'shared.yaml');
    await writePersona(stateDir, 'shared', 'State version');
    await writePersona(repositoryDir, 'shared', 'Repository version');

    const registry = new PersonaRegistry();
    await loadLayeredPersonaDirs(registry, [stateDir, repositoryDir]);
    await rm(repositoryFile);
    await registry.reloadAll();
    await loadLayeredPersonaDirs(registry, [stateDir, repositoryDir]);

    expect(registry.get('shared')?.displayName).toBe('State version');
  });

  test('missing state directory is skipped while the repository layer loads', async () => {
    const parent = await personaDir('persona-missing-parent-');
    process.env.MONAD_PERSONAS_DIR = join(parent, 'missing');
    const registry = getGlobalPersonaRegistry();

    await expect(awaitGlobalPersonaLoad()).resolves.toBeDefined();
    expect(registry.get('contrarian')).toBeDefined();
  });

  test('non-missing directory errors are propagated', async () => {
    const parent = await personaDir('persona-not-directory-');
    const notDirectory = join(parent, 'persona.yaml');
    await writeFile(notDirectory, 'not a directory');
    const registry = new PersonaRegistry();

    await expect(loadLayeredPersonaDirs(registry, [notDirectory])).rejects.toBeDefined();
  });

  test('explicit Sprint21 personasDir isolates the registry from MONAD_PERSONAS_DIR', async () => {
    const explicitDir = await personaDir('persona-explicit-');
    const stateDir = await personaDir('persona-state-');
    await writePersona(explicitDir, 'explicit-only', 'Explicit only');
    await writePersona(stateDir, 'state-only', 'State only');
    process.env.MONAD_PERSONAS_DIR = stateDir;

    const runtime = await wireSprint21Runtime({
      bot: {} as any,
      token: 'token',
      appId: 'application',
      personasDir: explicitDir,
      watchPersonas: false,
      fetchImpl: fakeFetch(),
    });

    expect(runtime.registry.get('explicit-only')?.displayName).toBe('Explicit only');
    expect(runtime.registry.get('state-only')).toBeUndefined();
    expect(runtime.registry.get('contrarian')).toBeUndefined();
    runtime.shutdown();
  });

  test('default Sprint21 path loads state and repository layers', async () => {
    const stateDir = await personaDir('persona-state-');
    await writePersona(stateDir, 'state-only', 'State only');
    process.env.MONAD_PERSONAS_DIR = stateDir;

    const runtime = await wireSprint21Runtime({
      bot: {} as any,
      token: 'token',
      appId: 'application',
      watchPersonas: false,
      fetchImpl: fakeFetch(),
    });

    expect(runtime.registry.get('state-only')?.displayName).toBe('State only');
    expect(runtime.registry.get('contrarian')).toBeDefined();
    expect(resolveRepositoryPersonaDir()).toContain('personas');
    runtime.shutdown();
  });

  test('global reload uses the same layered production path', async () => {
    const stateDir = await personaDir('persona-state-');
    await writePersona(stateDir, 'state-only', 'Before reload');
    process.env.MONAD_PERSONAS_DIR = stateDir;
    const registry = getGlobalPersonaRegistry();
    await awaitGlobalPersonaLoad();
    await writePersona(stateDir, 'state-only', 'After reload');

    await reloadGlobalPersonaRegistry();

    expect(registry.get('state-only')?.displayName).toBe('After reload');
    expect(registry.get('contrarian')).toBeDefined();
  });
});
