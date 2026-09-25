// ── PX-5 P3: keyword detector + $name parser ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  detectKeywords,
  parseExplicitInvocation,
  tokenize,
} from '../src/plugin-routes/detector';
import { RouteRegistry } from '../src/plugin-routes/registry';

describe('PX-5 P3 — tokenize', () => {
  test('splits on whitespace + punctuation', () => {
    expect(tokenize('hello, world.')).toEqual(['hello', 'world']);
  });
  test('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
  test('collapses multiple separators', () => {
    expect(tokenize('a  ,, b...c')).toEqual(['a', 'b', 'c']);
  });
});

describe('PX-5 P3 — parseExplicitInvocation', () => {
  test('recognises $name followed by args', () => {
    const r = parseExplicitInvocation('$explore find src/input-core');
    expect(r?.routeId).toBe('explore');
    expect(r?.argsText).toBe('find src/input-core');
    expect(r?.fullToken).toBe('$explore');
  });

  test('lowercases route id', () => {
    const r = parseExplicitInvocation('$EXPLORE do the thing');
    expect(r?.routeId).toBe('explore');
  });

  test('$name without args → empty argsText', () => {
    const r = parseExplicitInvocation('$plan');
    expect(r?.routeId).toBe('plan');
    expect(r?.argsText).toBe('');
  });

  test('leading whitespace is tolerated', () => {
    const r = parseExplicitInvocation('   $ralph go');
    expect(r?.routeId).toBe('ralph');
  });

  test('no $ → null', () => {
    expect(parseExplicitInvocation('hello')).toBeNull();
  });

  test('$$ (double dollar) is ignored', () => {
    expect(parseExplicitInvocation('$$math')).toBeNull();
  });

  test('rejects invalid id chars', () => {
    // Empty tag
    expect(parseExplicitInvocation('$ ')).toBeNull();
    // Non-alphanumeric start
    expect(parseExplicitInvocation('$-bad')).toBeNull();
  });

  test('routeId max 64 chars', () => {
    const long = 'a'.repeat(70);
    // EXPLICIT_INVOCATION_RE caps at {0,63} + 1 leading = 64 total;
    // 70 fails the primary regex.
    expect(parseExplicitInvocation(`$${long}`)).toBeNull();
  });
});

describe('PX-5 P3 — detectKeywords', () => {
  let reg: RouteRegistry;
  beforeEach(() => {
    reg = new RouteRegistry({ warnOnConflict: false });
    reg.register('agent-team', {
      id: 'explore', aliases: ['search', 'find'],
      target: { kind: 'agent', id: 'explore' }, precedence: 100,
    });
    reg.register('custom', {
      id: 'ralph', aliases: ['loop'],
      target: { kind: 'workflow', id: 'ralph-loop' }, precedence: 50,
    });
  });

  test('returns empty when no keyword matches', () => {
    const hits = detectKeywords('nothing to see here', { registry: reg });
    expect(hits.length).toBe(0);
  });

  test('matches primary keyword', () => {
    const hits = detectKeywords('please explore the module', { registry: reg });
    expect(hits.map(h => h.id)).toEqual(['explore']);
  });

  test('matches alias', () => {
    const hits = detectKeywords('we need to search for X', { registry: reg });
    expect(hits.map(h => h.id)).toEqual(['explore']);
  });

  test('sorts by precedence (lower first)', () => {
    const hits = detectKeywords('ralph will explore', { registry: reg });
    expect(hits.map(h => h.id)).toEqual(['ralph', 'explore']);
  });

  test('honours limit option', () => {
    const hits = detectKeywords('ralph explore find', { registry: reg, limit: 1 });
    expect(hits.length).toBe(1);
  });
});
