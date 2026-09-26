// ── PX-7 P1: discovery ──

import { describe, test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DECLARATIVE_KINDS,
  listDeclarativeFiles,
  resolveDeclarativeSources,
} from '../src/plugin-declarative/discovery';

function scratch(): string { return mkdtempSync(join(tmpdir(), 'pd-disc-')); }

describe('PX-7 P1 — resolveDeclarativeSources', () => {
  test('env ELANOUS_HOME overrides default', () => {
    const dir = scratch();
    const custom = join(dir, 'custom-home');
    const r = resolveDeclarativeSources({
      env: { ELANOUS_HOME: custom },
      cwd: dir,
      home: dir,
    });
    expect(r.user).toBe(custom);
    for (const k of DECLARATIVE_KINDS) {
      expect(existsSync(join(custom, k))).toBe(true);
    }
  });

  test('project source appears when <cwd>/.elanous exists', () => {
    const dir = scratch();
    const fakeHome = join(dir, 'home');
    mkdirSync(join(dir, '.elanous'), { recursive: true });
    const r = resolveDeclarativeSources({ env: {}, cwd: dir, home: fakeHome });
    expect(r.project).toBe(join(dir, '.elanous'));
  });

  test('project source undefined when <cwd>/.elanous missing', () => {
    const dir = scratch();
    const fakeHome = join(dir, 'home');
    const r = resolveDeclarativeSources({ env: {}, cwd: dir, home: fakeHome });
    expect(r.project).toBeUndefined();
  });

  test('auto-creates 6 kind sub-directories under user root', () => {
    const dir = scratch();
    const r = resolveDeclarativeSources({ env: { ELANOUS_HOME: join(dir, 'h') }, cwd: dir, home: dir });
    for (const k of DECLARATIVE_KINDS) {
      expect(existsSync(join(r.user, k))).toBe(true);
    }
  });
});

describe('PX-7 P1 — listDeclarativeFiles', () => {
  test('agents: returns .md files, sorted, absolute paths', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'b.md'), '');
    writeFileSync(join(dir, 'agents', 'a.md'), '');
    writeFileSync(join(dir, 'agents', '.hidden.md'), '');
    writeFileSync(join(dir, 'agents', '_skip.md'), '');
    writeFileSync(join(dir, 'agents', 'plain.txt'), '');
    const files = listDeclarativeFiles(dir, 'agents');
    expect(files.map(p => p.split('/').pop())).toEqual(['a.md', 'b.md']);
  });

  test('missions: discovers subdirectory/mission.md layout', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'missions', 'goal-1'), { recursive: true });
    writeFileSync(join(dir, 'missions', 'goal-1', 'mission.md'), '');
    writeFileSync(join(dir, 'missions', 'goal-1', 'sandbox.md'), '');
    const files = listDeclarativeFiles(dir, 'missions');
    expect(files.length).toBe(1);
    expect(files[0]).toContain('goal-1/mission.md');
  });

  test('missing kind dir → []', () => {
    const dir = scratch();
    expect(listDeclarativeFiles(dir, 'routes')).toEqual([]);
  });
});
