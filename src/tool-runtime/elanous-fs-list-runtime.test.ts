// PLAN-codex-app-server-hermes-parity §5 Phase H1·5d test —
// dispatchElanousFsList enumeration + clamp + filter + cap. Uses an
// isolated tmp directory + rootResolver override so the test never
// touches the daemon's real cwd or the user's vault.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsRootKind } from '../acp/fs-roots.js';
import {
  dispatchElanousFsList,
  elanousFsListRuntime,
  buildElanousFsListTool,
} from './elanous-fs-list-runtime.js';

let workdir: string;
let resolver: (kind: FsRootKind) => string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'elanous-fs-test-'));
  resolver = (_kind) => workdir;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('dispatchElanousFsList · root selection', () => {
  test("defaults to root='cwd' when args.root is omitted", async () => {
    const r = await dispatchElanousFsList({}, { rootResolver: resolver });
    expect(r.root).toBe('cwd');
  });

  test("passes through root='obsidian'", async () => {
    const r = await dispatchElanousFsList(
      { root: 'obsidian' },
      { rootResolver: resolver },
    );
    expect(r.root).toBe('obsidian');
  });

  test('returns error when resolver throws', async () => {
    const r = await dispatchElanousFsList(
      { root: 'obsidian' },
      {
        rootResolver: (kind) => {
          if (kind === 'obsidian') throw new Error('obsidian-vault-unavailable');
          return workdir;
        },
      },
    );
    expect(r.error).toBe('obsidian-vault-unavailable');
    expect(r.entries).toEqual([]);
  });
});

describe('dispatchElanousFsList · enumeration', () => {
  test('lists entries with isDir flag set correctly', async () => {
    mkdirSync(join(workdir, 'subdir'));
    writeFileSync(join(workdir, 'a.txt'), 'hi');
    writeFileSync(join(workdir, 'b.md'), 'hi');
    const r = await dispatchElanousFsList({}, { rootResolver: resolver });
    expect(r.entries).toEqual([
      { name: 'subdir', isDir: true, relPath: 'subdir' },
      { name: 'a.txt', isDir: false, relPath: 'a.txt' },
      { name: 'b.md', isDir: false, relPath: 'b.md' },
    ]);
  });

  test('sorts dirs before files, then alphabetically inside each group', async () => {
    mkdirSync(join(workdir, 'zeta'));
    mkdirSync(join(workdir, 'alpha'));
    writeFileSync(join(workdir, 'm.txt'), '');
    writeFileSync(join(workdir, 'a.txt'), '');
    const r = await dispatchElanousFsList({}, { rootResolver: resolver });
    expect(r.entries.map((e) => e.name)).toEqual([
      'alpha',
      'zeta',
      'a.txt',
      'm.txt',
    ]);
  });

  test('filters hidden entries (isHiddenForBrowser)', async () => {
    writeFileSync(join(workdir, '.env'), '');
    writeFileSync(join(workdir, '.DS_Store'), '');
    writeFileSync(join(workdir, 'visible.txt'), '');
    mkdirSync(join(workdir, '.git'));
    const r = await dispatchElanousFsList({}, { rootResolver: resolver });
    expect(r.entries.map((e) => e.name)).toEqual(['visible.txt']);
  });

  test('applies substring query filter (case-insensitive)', async () => {
    writeFileSync(join(workdir, 'README.md'), '');
    writeFileSync(join(workdir, 'readme.txt'), '');
    writeFileSync(join(workdir, 'other.txt'), '');
    const r = await dispatchElanousFsList(
      { query: 'readme' },
      { rootResolver: resolver },
    );
    expect(r.entries.map((e) => e.name).sort()).toEqual([
      'README.md',
      'readme.txt',
    ]);
  });

  test('caps to limit', async () => {
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(workdir, `f-${i.toString().padStart(2, '0')}.txt`), '');
    }
    const r = await dispatchElanousFsList(
      { limit: 5 },
      { rootResolver: resolver },
    );
    expect(r.entries).toHaveLength(5);
  });

  test('limit out-of-range falls back to default 200', async () => {
    const r = await dispatchElanousFsList(
      { limit: -1 },
      { rootResolver: resolver },
    );
    expect(r.entries).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});

describe('dispatchElanousFsList · clamp', () => {
  test('explicit cwd within root works', async () => {
    mkdirSync(join(workdir, 'nested'));
    writeFileSync(join(workdir, 'nested', 'a.txt'), '');
    const r = await dispatchElanousFsList(
      { cwd: join(workdir, 'nested') },
      { rootResolver: resolver },
    );
    expect(r.entries.map((e) => e.name)).toEqual(['a.txt']);
  });

  test('cwd escaping root → cwd-escapes-root error', async () => {
    const escapee = join(workdir, '..', '..', 'elsewhere');
    const r = await dispatchElanousFsList(
      { cwd: escapee },
      { rootResolver: resolver },
    );
    expect(r.error).toBe('cwd-escapes-root');
    expect(r.entries).toEqual([]);
  });

  test('non-existent cwd → read error returned', async () => {
    const missing = join(workdir, 'does-not-exist');
    const r = await dispatchElanousFsList(
      { cwd: missing },
      { rootResolver: resolver },
    );
    expect(r.entries).toEqual([]);
    expect(r.error).toContain('ENOENT');
  });
});

describe('elanousFsListRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousFsListRuntime.id).toBe('elanous_fs_list');
    expect(elanousFsListRuntime.spec.name).toBe('elanous_fs_list');
  });

  test('buildElanousFsListTool returns LLMToolSpec with root enum', () => {
    const spec = buildElanousFsListTool();
    const params = spec.parameters as {
      properties: { root?: { enum?: string[] } };
    };
    expect(params.properties.root?.enum).toEqual(['cwd', 'obsidian']);
  });
});
