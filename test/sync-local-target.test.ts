import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RSYNC_EXCLUDES, syncServers, isLocalSyncServer } from '../src/config.js';
import { buildRsyncArgs, resolveRsyncDestination } from '../src/sync.js';
import { getRemoteFileContent, getRemoteFileHash, getRemoteFileList } from '../src/inspect.js';
import { getFileTree } from '../src/hasher.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monad-sync-local-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('local sync target', () => {
  test('local is available as a first-class server target', () => {
    expect(syncServers()[0]).toBe('local');
    expect(syncServers()).toContain('local');
  });

  test('recognizes local aliases without SSH', () => {
    expect(isLocalSyncServer('local')).toBe(true);
    expect(isLocalSyncServer('localhost')).toBe(true);
    expect(isLocalSyncServer('127.0.0.1')).toBe(true);
    expect(isLocalSyncServer('::1')).toBe(true);
    expect(isLocalSyncServer('node-b')).toBe(false);
  });

  test('rsync destination omits host prefix for local targets only', () => {
    expect(resolveRsyncDestination('local', '/tmp/skills/foo/')).toBe('/tmp/skills/foo/');
    expect(resolveRsyncDestination('node-b', '/tmp/skills/foo/')).toBe('node-b:/tmp/skills/foo/');
  });

  test('local file helpers read from filesystem', async () => {
    const remotePath = join(root, 'skills') + '/';
    const skillDir = join(remotePath, 'alpha');
    mkdirSync(join(skillDir, 'src'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# alpha\n');
    writeFileSync(join(skillDir, 'src', 'index.ts'), 'export const x = 1;\n');

    const files = await getRemoteFileList('local', remotePath, 'alpha');
    expect(files).toEqual(['SKILL.md', 'src/index.ts']);
    expect(await getRemoteFileContent('local', remotePath, 'alpha/SKILL.md')).toBe('# alpha\n');
    expect(await getRemoteFileHash('local', remotePath, 'alpha/SKILL.md')).toHaveLength(64);
  });
});

describe('sync dependency excludes', () => {
  test('rsync excludes node and python dependency/cached artifacts', () => {
    const args = buildRsyncArgs('merge');
    const excludes = args.filter(arg => arg.startsWith('--exclude='));

    for (const pattern of [
      'node_modules/',
      '.pnpm-store/',
      '__pycache__/',
      '.venv/',
      'venv/',
      'env/',
      'site-packages/',
      '*.pyc',
      '*.pyo',
      '*.egg-info/',
      '*.dist-info/',
      '.pytest_cache/',
      '.mypy_cache/',
      '.ruff_cache/',
    ]) {
      expect(RSYNC_EXCLUDES).toContain(pattern);
      expect(excludes).toContain(`--exclude=${pattern}`);
    }
  });

  test('skill hashing ignores dependency artifacts too', () => {
    const skillDir = join(root, 'alpha');
    mkdirSync(join(skillDir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(skillDir, '.venv', 'lib'), { recursive: true });
    mkdirSync(join(skillDir, 'site-packages', 'pkg'), { recursive: true });
    mkdirSync(join(skillDir, 'src', '__pycache__'), { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# alpha\n');
    writeFileSync(join(skillDir, 'node_modules', 'pkg', 'index.js'), 'ignored\n');
    writeFileSync(join(skillDir, '.venv', 'lib', 'dep.py'), 'ignored\n');
    writeFileSync(join(skillDir, 'site-packages', 'pkg', 'dep.py'), 'ignored\n');
    writeFileSync(join(skillDir, 'src', '__pycache__', 'dep.pyc'), 'ignored\n');

    expect(getFileTree(skillDir).map(entry => entry.path)).toEqual(['SKILL.md']);
  });
});
