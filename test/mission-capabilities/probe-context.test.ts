import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requestId = 'req:v1:abcdef0123456789';
const roots: string[] = [];
const ghCwds: string[] = [];
let ghSuccessRoot = '';
const realExecFileSync = childProcess.execFileSync;

function root(name: string): string {
  const path = mkdtempSync(join(tmpdir(), `probe-context-${name}-`));
  roots.push(path);
  return path;
}

function git(rootPath: string, ...args: string[]): void {
  realExecFileSync('git', args, { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repository(rootPath: string, committed: boolean): void {
  git(rootPath, 'init', '-q');
  if (!committed) return;
  git(rootPath, 'config', 'user.email', 'test@example.com');
  git(rootPath, 'config', 'user.name', 'test');
  writeFileSync(join(rootPath, 'commit.txt'), 'commit\n');
  git(rootPath, 'add', 'commit.txt');
  git(rootPath, 'commit', '-q', '-m', 'ready');
}

function writeBlueprint(authorityRoot: string): void {
  const directory = join(authorityRoot, 'src', 'mission-blueprints');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'req-v1-abcdef0123456789.ts'), `export default {
  id: '${requestId}',
  requires: [{ id: 'report.landingcount' }, { id: 'report.openprcount' }],
  produces: { kind: 'report', deliver: [] },
  async run() { return { ok: true, body: 'ready', measured: {} }; },
};`);
}

function observeGh(): ReturnType<typeof spyOn> {
  return spyOn(childProcess, 'execFileSync').mockImplementation(((command: string, args: readonly string[] | undefined, options: { cwd?: string } | undefined) => {
    if (command === 'gh') {
      const cwd = options?.cwd ?? '';
      ghCwds.push(cwd);
      return cwd === ghSuccessRoot ? '[{"number":1,"state":"OPEN"}]' : 'not-a-snapshot';
    }
    return realExecFileSync(command, args, options as Parameters<typeof realExecFileSync>[2]);
  }) as never);
}

afterEach(() => {
  ghCwds.splice(0);
  ghSuccessRoot = '';
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('capability probe authority context', () => {
  test('the loader sends authorityRoot to discovered tree-measuring providers', async () => {
    const cwdRoot = root('cwd');
    const authorityRoot = root('authority');
    repository(cwdRoot, false);
    repository(authorityRoot, true);
    writeBlueprint(authorityRoot);
    ghSuccessRoot = authorityRoot;
    const ghSpy = observeGh();

    try {
      const { discoverCapabilityProviders } = await import('../../src/mission-capabilities/registry.js');
      const { loadMissionBlueprint } = await import('../../src/mission-blueprints/loader.js');
      const catalog = await discoverCapabilityProviders();
      const treeProviders = catalog.filter(provider => provider.id === 'report.landingcount' || provider.id === 'report.openprcount');
      expect(treeProviders.map(provider => provider.id).sort()).toEqual(['report.landingcount', 'report.openprcount']);

      const priorCwd = process.cwd();
      process.chdir(cwdRoot);
      try {
        const result = await loadMissionBlueprint({
          authorityRoot,
          requestId,
          requestRequires: treeProviders.map(provider => ({ id: provider.id })),
          catalog: treeProviders,
        });
        expect(result).toMatchObject({ status: 'ready' });
        expect(ghCwds).toEqual([authorityRoot]);
      } finally {
        process.chdir(priorCwd);
      }
    } finally {
      ghSpy.mockRestore();
    }
  });

  test('missing authority roots fail with the requested root rather than silently using cwd', async () => {
    const missingRoot = join(root('missing-parent'), 'does-not-exist');
    const ghSpy = observeGh();
    try {
      const { discoverCapabilityProviders } = await import('../../src/mission-capabilities/registry.js');
      const providers = (await discoverCapabilityProviders()).filter(provider => provider.id === 'report.landingcount' || provider.id === 'report.openprcount');
      for (const provider of providers) {
        const result = await provider.probe({ authorityRoot: missingRoot });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`${provider.id} silently accepted a missing authority root.`);
        expect(result.reason).toContain(missingRoot);
      }
      expect(ghCwds).toEqual([missingRoot]);
    } finally {
      ghSpy.mockRestore();
    }
  });

  test('direct no-argument probes retain cwd behavior and the open-pr failure string', async () => {
    const cwdRoot = root('cwd');
    const authorityRoot = root('authority');
    repository(cwdRoot, false);
    repository(authorityRoot, true);
    ghSuccessRoot = authorityRoot;
    const ghSpy = observeGh();
    try {
      const { discoverCapabilityProviders } = await import('../../src/mission-capabilities/registry.js');
      const providers = (await discoverCapabilityProviders()).filter(provider => provider.id === 'report.landingcount' || provider.id === 'report.openprcount');
      const priorCwd = process.cwd();
      process.chdir(cwdRoot);
      try {
        for (const provider of providers) {
          const result = await provider.probe();
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error(`${provider.id} did not read the cwd tree.`);
          if (provider.id === 'report.landingcount') expect(result.reason).toContain(cwdRoot);
          if (provider.id === 'report.openprcount') expect(result.reason).toBe('Open pull-request snapshot is missing, malformed, or truncated.');
        }
        expect(ghCwds).toEqual([realpathSync(cwdRoot)]);
      } finally {
        process.chdir(priorCwd);
      }
    } finally {
      ghSpy.mockRestore();
    }
  });
});
