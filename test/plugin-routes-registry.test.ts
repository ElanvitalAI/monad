// ── PX-5 P1: route registry tests ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RouteRegistry, tokenize } from '../src/plugin-routes/registry';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'route-test-'));
}

describe('PX-5 P1 — RouteRegistry.compile + list', () => {
  test('register returns a disposer that removes the entry', () => {
    const reg = new RouteRegistry();
    const d = reg.register('p1', {
      id: 'explore',
      target: { kind: 'agent', id: 'explore' },
    });
    expect(reg.size).toBe(1);
    d();
    expect(reg.size).toBe(0);
  });

  test('register rejects duplicate `<plugin>:<routeId>` key', () => {
    const reg = new RouteRegistry();
    reg.register('p1', { id: 'dup', target: { kind: 'agent', id: 'a' } });
    expect(() =>
      reg.register('p1', { id: 'dup', target: { kind: 'agent', id: 'b' } })
    ).toThrow(/already registered/);
  });

  test('compile lowercases id + aliases when caseInsensitive', () => {
    const reg = new RouteRegistry({ warnOnConflict: false });
    reg.register('p1', {
      id: 'explore',
      aliases: ['EXPLORE', 'SEARCH'],
      target: { kind: 'agent', id: 'explore' },
    });
    const r = reg.list()[0]!;
    expect(r.keywords).toContain('explore');
    expect(r.keywords).toContain('search');
    expect(r.keywords).not.toContain('EXPLORE');
  });

  test('compile clamps non-builtin precedence <10 to 10 + warns', () => {
    const reg = new RouteRegistry({ warnOnConflict: false });
    reg.register('p1', {
      id: 'r', target: { kind: 'agent', id: 'a' }, precedence: 3,
    }, /* isBuiltin = */ false);
    expect(reg.list()[0]!.precedence).toBe(10);
  });

  test('builtin routes keep precedence <10', () => {
    const reg = new RouteRegistry({ warnOnConflict: false });
    reg.register('core', {
      id: 'andon', target: { kind: 'skill', id: 'andon' }, precedence: 5,
    }, /* isBuiltin = */ true);
    expect(reg.list()[0]!.precedence).toBe(5);
  });
});

describe('PX-5 P1 — match + resolveExplicit', () => {
  let reg: RouteRegistry;
  beforeEach(() => {
    reg = new RouteRegistry({ warnOnConflict: false });
    reg.register('agent-team', {
      id: 'explore', aliases: ['search', 'find'],
      target: { kind: 'agent', id: 'explore' }, precedence: 100,
    });
    reg.register('agent-team', {
      id: 'plan', aliases: ['design'],
      target: { kind: 'agent', id: 'plan' }, precedence: 100,
    });
    reg.register('custom', {
      id: 'ralph',
      target: { kind: 'workflow', id: 'ralph-loop' }, precedence: 50,
    });
  });

  test('match scans text tokens case-insensitively', () => {
    const hits = reg.match('Please Explore the module');
    expect(hits.map(r => r.id)).toEqual(['explore']);
  });

  test('match picks up aliases too', () => {
    const hits = reg.match('please design a refactor');
    expect(hits.map(r => r.id)).toEqual(['plan']);
  });

  test('match sorts multiple hits by precedence (lower first)', () => {
    const hits = reg.match('ralph find something');
    expect(hits.map(r => r.id)).toEqual(['ralph', 'explore']);
  });

  test('match respects limit option', () => {
    const hits = reg.match('ralph find design', { limit: 2 });
    expect(hits.length).toBe(2);
  });

  test('resolveExplicit finds a route by bare id', () => {
    const r = reg.resolveExplicit('plan');
    expect(r?.target.id).toBe('plan');
  });

  test('resolveExplicit accepts `pluginId:routeId` notation', () => {
    const r = reg.resolveExplicit('agent-team:plan');
    expect(r?.pluginId).toBe('agent-team');
  });

  test('resolveExplicit returns null on no match', () => {
    expect(reg.resolveExplicit('nowhere')).toBeNull();
  });
});

describe('PX-5 P1 — persist snapshot', () => {
  test('persist writes .elanous/routes.json with schemaVersion 1', async () => {
    const dir = scratchDir();
    const reg = new RouteRegistry({ compiledRoot: dir, warnOnConflict: false });
    reg.register('p1', { id: 'r', target: { kind: 'agent', id: 'a' } });
    const outPath = await reg.persist();
    expect(outPath).toBeTruthy();
    expect(existsSync(join(dir, '.elanous', 'routes.json'))).toBe(true);
    const raw = readFileSync(join(dir, '.elanous', 'routes.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.routes.length).toBe(1);
    expect(parsed.routes[0].id).toBe('r');
  });
});

describe('PX-5 P1 — tokenize helper', () => {
  test('splits on whitespace + common punctuation', () => {
    expect(tokenize('hello, world. foo!')).toEqual(['hello', 'world', 'foo']);
    expect(tokenize('  a  b   c')).toEqual(['a', 'b', 'c']);
    expect(tokenize('')).toEqual([]);
  });
});
