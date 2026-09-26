import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArtifactLaunchCommand } from './artifact-launch-command.js';

const dirs: string[] = [];

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'artifact-launch-command-'));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(join(destination, '..'), { recursive: true });
    writeFileSync(destination, content);
  }
  return realpathSync(root);
}

function resolveIn(root: string, entrypoint: string | undefined, target = 'src/app.ts') {
  return resolveArtifactLaunchCommand({ entrypoint, targetPath: join(root, target), repositoryRoot: root });
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('resolveArtifactLaunchCommand', () => {
  test('collects package, Makefile, and Procfile exact key and token matches across all ancestors', async () => {
    const root = repository({
      'package.json': JSON.stringify({ scripts: { root: 'bun root.ts', ignored: 'bun roots.ts' } }),
      Makefile: 'make-target:\n\t@echo ok\n',
      Procfile: 'web: bun worker.ts\n',
      'nested/package.json': JSON.stringify({ scripts: { nested: 'bun nested.ts' } }),
      'nested/src/app.ts': '',
    });

    const rootResult = await resolveIn(root, 'root', 'nested/src/app.ts');
    const makeResult = await resolveIn(root, 'make-target', 'nested/src/app.ts');
    const procResult = await resolveIn(root, 'worker.ts', 'nested/src/app.ts');
    const nestedResult = await resolveIn(root, 'nested', 'nested/src/app.ts');

    expect(rootResult.command).toBe('bun root.ts');
    expect(makeResult.command).toBe('make make-target');
    expect(procResult.command).toBe('bun worker.ts');
    expect(nestedResult.command).toBe('bun nested.ts');
    expect(rootResult.sources.map((item) => item.path)).toEqual([
      join(root, 'nested', 'package.json'),
      join(root, 'package.json'),
      join(root, 'Makefile'),
      join(root, 'Procfile'),
    ]);
  });

  test('does not search above the supplied repository root', async () => {
    const parent = repository({
      'package.json': JSON.stringify({ scripts: { outside: 'bun outside.ts' } }),
      'repo/package.json': JSON.stringify({ scripts: { inside: 'bun inside.ts' } }),
      'repo/src/app.ts': '',
    });
    const root = join(parent, 'repo');

    const result = await resolveIn(root, 'outside');

    expect(result).toMatchObject({ reason: 'no-command-source', candidates: [] });
    expect(result.sources.map((item) => item.path)).toEqual([join(root, 'package.json')]);
  });

  test('reports every scanned source and makes no command for nonmatches, blanks, invalid paths, and parse failures', async () => {
    const root = repository({
      'package.json': '{',
      Makefile: 'target:\n',
      Procfile: 'web: bun web.ts\n',
      'src/app.ts': '',
    });

    expect(await resolveIn(root, 'missing')).toMatchObject({
      reason: 'no-command-source',
      candidates: [],
      sources: [
        { path: join(root, 'package.json'), kind: 'package-json', status: 'parse-error' },
        { path: join(root, 'Makefile'), kind: 'makefile', status: 'scanned' },
        { path: join(root, 'Procfile'), kind: 'procfile', status: 'scanned' },
      ],
    });
    expect(await resolveIn(root, '')).toEqual({ sources: [], candidates: [], reason: 'missing-entrypoint' });
    expect(await resolveIn(root, undefined)).toEqual({ sources: [], candidates: [], reason: 'missing-entrypoint' });
    expect(await resolveArtifactLaunchCommand({ entrypoint: 'target', targetPath: join(root, 'missing.ts'), repositoryRoot: root })).toEqual({
      sources: [], candidates: [], reason: 'invalid-target-path',
    });
  });

  test('does not normalize or perform partial matches, and retains duplicate candidates as ambiguity', async () => {
    const root = repository({
      'package.json': JSON.stringify({ scripts: { dev: 'bun src/app.ts', similar: 'bun src/app.tsx' } }),
      Procfile: 'web: bun src/app.ts\n',
      'src/app.ts': '',
    });

    const partial = await resolveIn(root, 'app.ts');
    const normalized = await resolveIn(root, './src/app.ts');
    const whitespace = await resolveIn(root, ' src/app.ts ');
    const duplicate = await resolveIn(root, 'src/app.ts');

    expect(partial).toMatchObject({ reason: 'no-command-source', candidates: [] });
    expect(normalized).toMatchObject({ reason: 'no-command-source', candidates: [] });
    expect(whitespace).toMatchObject({ reason: 'no-command-source', candidates: [] });
    expect(duplicate.reason).toBe('ambiguous-command-source');
    expect(duplicate.command).toBeUndefined();
    expect(duplicate.candidates.map((item) => item.location)).toEqual([
      `${join(root, 'package.json')}:dev`,
      `${join(root, 'Procfile')}:web`,
    ]);
  });

  test('uses the elanous CLI only after a clean injected help probe and never parses its help text', async () => {
    const root = repository({
      'package.json': JSON.stringify({ name: 'elanous', bin: { elanous: './bin/elanous.mjs' } }),
      'bin/elanous.mjs': '',
      'src/app.ts': '',
    });
    const received: string[][] = [];

    const accepted = await resolveArtifactLaunchCommand({
      entrypoint: 'launch', targetPath: join(root, 'src/app.ts'), repositoryRoot: root,
      runHelpProbe: (argv) => { received.push([...argv]); return { status: 0, stderr: 'unrelated launch-extra text' }; },
    });
    const rejected = await resolveArtifactLaunchCommand({
      entrypoint: 'launch', targetPath: join(root, 'src/app.ts'), repositoryRoot: root,
      runHelpProbe: () => ({ status: 1, stderr: 'unknown command launch' }),
    });

    expect(received).toEqual([['bun', 'bin/elanous.mjs', 'launch', '--help']]);
    expect(accepted).toMatchObject({ command: 'bun bin/elanous.mjs launch', candidates: [{ key: 'launch', sourceKind: 'elanous-cli' }] });
    expect(rejected.reason).toBe('no-command-source');
    expect(rejected.candidates).toEqual([]);
    expect(rejected.sources.some((item) => item.kind === 'elanous-cli' && item.status === 'scanned')).toBeTrue();
  });

  test('resolves the repository command fixtures without assigning source priority', async () => {
    const root = process.cwd();

    const deterministic = await resolveIn(root, 'test:deterministic', 'src/harness/artifact-launch-command.ts');
    const generated = await resolveIn(root, 'scripts/gen-cdp-types.ts', 'src/harness/artifact-launch-command.ts');
    const source = await resolveIn(root, 'src/index.ts', 'src/harness/artifact-launch-command.ts');
    const pwa = await resolveIn(root, 'dev', 'apps/pwa/src/app/page.tsx');

    expect(deterministic).toMatchObject({ command: 'bun run scripts/test-deterministic.ts --dots', candidates: [{ key: 'test:deterministic' }] });
    expect(generated).toMatchObject({ command: 'bun run scripts/gen-cdp-types.ts', candidates: [{ key: 'gen:cdp' }] });
    expect(source.reason).toBe('ambiguous-command-source');
    expect(source.command).toBeUndefined();
    expect(source.candidates.map((item) => item.key)).toEqual(['dev', 'build', 'sync', 'status', 'history', 'smart']);
    expect(pwa.reason).toBe('ambiguous-command-source');
    expect(pwa.command).toBeUndefined();
    expect(pwa.candidates.map((item) => item.location)).toEqual([
      `${join(root, 'apps/pwa/package.json')}:dev`,
      `${join(root, 'package.json')}:dev`,
    ]);
  });
});
