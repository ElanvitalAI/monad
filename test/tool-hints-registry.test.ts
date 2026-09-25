import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  addHint,
  consumeUse,
  endSession,
  endTurn,
  flushSave,
  listHints,
  removeHint,
  resetScope,
  setConfigPathForTesting,
  _debugState,
  _reloadForTesting,
} from '../src/tool-hints/registry.js';

let tmpDir: string;
let configPath: string;
const ORIGINAL_CWD_ENV = process.env.HINTS_PROJECT_CWD;

beforeEach(() => {
  tmpDir = joinPath(tmpdir(), `mh-hints-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  configPath = joinPath(tmpDir, 'hints.json');
  setConfigPathForTesting(configPath);
  // Deterministic project scoping so tests don't spray into $PWD.
  process.env.HINTS_PROJECT_CWD = joinPath(tmpDir, 'fake-project');
  _reloadForTesting();
});

afterEach(() => {
  // Leave registry in a clean state for next test.
  flushSave();
  setConfigPathForTesting(null);
  if (ORIGINAL_CWD_ENV === undefined) delete process.env.HINTS_PROJECT_CWD;
  else process.env.HINTS_PROJECT_CWD = ORIGINAL_CWD_ENV;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('registry — basic CRUD', () => {
  test('addHint fills id + createdAt when not provided', () => {
    const h = addHint({ kind: 'prefer', tool: 'web_search', scope: 'turn' });
    expect(h.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(h.createdAt).toBeGreaterThan(0);
    expect(h.scope).toBe('turn');
    expect(h.tool).toBe('web_search');
  });

  test('addHint respects explicit id + createdAt for determinism', () => {
    const h = addHint({ kind: 'prefer', tool: 'web_search', scope: 'turn', id: 'abc12345', createdAt: 42 });
    expect(h.id).toBe('abc12345');
    expect(h.createdAt).toBe(42);
  });

  test('listHints without scope returns turn→session→project→global order', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'global', id: 'G' });
    addHint({ kind: 'prefer', tool: 'b', scope: 'project', id: 'P' });
    addHint({ kind: 'prefer', tool: 'c', scope: 'session', id: 'S' });
    addHint({ kind: 'prefer', tool: 'd', scope: 'turn', id: 'T' });
    expect(listHints().map(h => h.id)).toEqual(['T', 'S', 'P', 'G']);
  });

  test('listHints(scope) returns only that scope', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 't1' });
    addHint({ kind: 'avoid', tool: 'b', scope: 'turn', id: 't2' });
    addHint({ kind: 'prefer', tool: 'a', scope: 'session', id: 's1' });
    expect(listHints('turn').map(h => h.id).sort()).toEqual(['t1', 't2']);
    expect(listHints('session').map(h => h.id)).toEqual(['s1']);
  });

  test('removeHint finds across scopes and returns false when missing', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'session', id: 'here' });
    expect(removeHint('here')).toBe(true);
    expect(removeHint('here')).toBe(false);
    expect(removeHint('never-existed')).toBe(false);
  });

  test('resetScope("all") clears turn + session + project but preserves global', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn' });
    addHint({ kind: 'prefer', tool: 'b', scope: 'session' });
    addHint({ kind: 'prefer', tool: 'c', scope: 'project' });
    addHint({ kind: 'prefer', tool: 'd', scope: 'global' });
    const removed = resetScope('all');
    expect(removed).toBe(3);
    const state = _debugState();
    expect(state.turn).toEqual([]);
    expect(state.session).toEqual([]);
    expect(state.project).toEqual([]);
    expect(state.global.length).toBe(1);
  });

  test('resetScope("global") clears global explicitly', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'global' });
    expect(resetScope('global')).toBe(1);
    expect(_debugState().global).toEqual([]);
  });
});

describe('registry — TTL + usesLeft', () => {
  test('expiresAt in the past is pruned on read', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 'live',  expiresAt: Date.now() + 60_000 });
    addHint({ kind: 'prefer', tool: 'b', scope: 'turn', id: 'stale', expiresAt: Date.now() - 1 });
    const ids = listHints().map(h => h.id);
    expect(ids).toContain('live');
    expect(ids).not.toContain('stale');
  });

  test('consumeUse decrements usesLeft and removes at 0', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 'u', usesLeft: 2 });
    consumeUse('u');
    expect(_debugState().turn[0].usesLeft).toBe(1);
    consumeUse('u');
    expect(_debugState().turn.length).toBe(0);
  });

  test('consumeUse on a hint with no usesLeft is a no-op', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 'unlim' });
    consumeUse('unlim');
    expect(_debugState().turn.length).toBe(1);
    expect(_debugState().turn[0].usesLeft).toBeUndefined();
  });
});

describe('registry — persistence', () => {
  test('project + global hints round-trip through the JSON file', () => {
    addHint({ kind: 'prefer', tool: 'web_search', scope: 'project', id: 'p1', reason: 'focus' });
    addHint({ kind: 'avoid', tool: 'bash', scope: 'global', id: 'g1' });
    flushSave();

    _reloadForTesting();
    const hints = listHints();
    const ids = hints.map(h => h.id).sort();
    expect(ids).toEqual(['g1', 'p1']);
    const p = hints.find(h => h.id === 'p1');
    expect(p?.reason).toBe('focus');
  });

  test('turn + session hints never touch disk', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 'T' });
    addHint({ kind: 'prefer', tool: 'b', scope: 'session', id: 'S' });
    flushSave();
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
      const all: unknown[] = [...(parsed.global ?? []), ...Object.values(parsed.projects ?? {}).flat()];
      const ids = all.map(h => (h as { id: string }).id);
      expect(ids).not.toContain('T');
      expect(ids).not.toContain('S');
    }
    // Reload drops turn + session entirely.
    _reloadForTesting();
    expect(listHints('turn')).toEqual([]);
    expect(listHints('session')).toEqual([]);
  });

  test('other projects\' hints survive a save by the current project', () => {
    // Seed the file with a hint for another project, then add one
    // for the current project and save. The other should still be
    // in the file.
    const otherProject = joinPath(tmpDir, 'other-project');
    const seeded = {
      version: 1,
      global: [],
      projects: {
        [otherProject]: [{
          id: 'other1', kind: 'prefer', tool: 'web_search',
          scope: 'project', createdAt: 1,
        }],
      },
    };
    mkdirSync(joinPath(tmpDir), { recursive: true });
    writeFileSync(configPath, JSON.stringify(seeded), 'utf-8');
    _reloadForTesting();

    addHint({ kind: 'prefer', tool: 'mine', scope: 'project', id: 'mine1' });
    flushSave();

    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.projects[otherProject][0].id).toBe('other1');
    expect(saved.projects[process.env.HINTS_PROJECT_CWD!][0].id).toBe('mine1');
  });

  test('corrupt JSON file falls back to empty rather than throwing', () => {
    writeFileSync(configPath, '{{{ not valid json', 'utf-8');
    _reloadForTesting();
    expect(listHints()).toEqual([]);
  });

  test('file with unknown version is treated as empty', () => {
    writeFileSync(configPath, JSON.stringify({ version: 99, global: [], projects: {} }), 'utf-8');
    _reloadForTesting();
    expect(listHints()).toEqual([]);
  });

  test('malformed hint entries are dropped, valid ones kept', () => {
    const file = {
      version: 1,
      global: [
        { id: 'good', kind: 'prefer', tool: 'a', scope: 'global', createdAt: 1 },
        { id: 'missing-kind', tool: 'b', scope: 'global', createdAt: 2 },  // invalid
        'not-even-an-object',
      ],
      projects: {},
    };
    writeFileSync(configPath, JSON.stringify(file), 'utf-8');
    _reloadForTesting();
    const globals = listHints('global');
    expect(globals.length).toBe(1);
    expect(globals[0].id).toBe('good');
  });
});

describe('registry — lifecycle hooks', () => {
  test('endTurn() clears turn scope only', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn', id: 'T' });
    addHint({ kind: 'prefer', tool: 'b', scope: 'session', id: 'S' });
    addHint({ kind: 'prefer', tool: 'c', scope: 'project', id: 'P' });
    endTurn();
    const state = _debugState();
    expect(state.turn).toEqual([]);
    expect(state.session.length).toBe(1);
    expect(state.project.length).toBe(1);
  });

  test('endSession() clears turn + session + flushes pending save', () => {
    addHint({ kind: 'prefer', tool: 'a', scope: 'turn' });
    addHint({ kind: 'prefer', tool: 'b', scope: 'session' });
    addHint({ kind: 'prefer', tool: 'c', scope: 'project', id: 'persistP' });
    endSession();
    const state = _debugState();
    expect(state.turn).toEqual([]);
    expect(state.session).toEqual([]);
    // Project survives and is on disk (endSession flushes).
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    const projKey = process.env.HINTS_PROJECT_CWD!;
    expect(saved.projects[projKey].some((h: { id: string }) => h.id === 'persistP')).toBe(true);
  });
});
