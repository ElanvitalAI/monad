// ── PX-5 P2: manifest parser for contributes.routes[] ──

import { describe, expect, test } from 'bun:test';
import { parsePluginManifest } from '../src/plugins/core/manifest';

function base(contributes: Record<string, unknown>) {
  return parsePluginManifest({
    id: 'demo',
    name: 'Demo',
    version: '0.1.0',
    main: './plugin.ts',
    activationEvents: ['onStartup'],
    capabilities: [],
    contributes,
  });
}

describe('PX-5 P2 — parseRoutes', () => {
  test('accepts valid route with required fields', () => {
    const manifest = base({
      routes: [{
        id: 'explore',
        aliases: ['search', 'find'],
        target: { kind: 'agent', id: 'explore' },
        precedence: 100,
        description: 'Code scout',
      }],
    });
    const r = manifest.contributes.routes?.[0]!;
    expect(r.id).toBe('explore');
    expect(r.aliases).toEqual(['search', 'find']);
    expect(r.target.kind).toBe('agent');
  });

  test('rejects invalid id (uppercase, starts with dash)', () => {
    expect(() => base({
      routes: [{ id: 'Upper', target: { kind: 'agent', id: 'a' } }],
    })).toThrow(/\.id must match/);
    expect(() => base({
      routes: [{ id: '-lead-dash', target: { kind: 'agent', id: 'a' } }],
    })).toThrow(/\.id must match/);
  });

  test('rejects duplicate ids within one manifest', () => {
    expect(() => base({
      routes: [
        { id: 'dup', target: { kind: 'agent', id: 'a' } },
        { id: 'dup', target: { kind: 'skill', id: 'b' } },
      ],
    })).toThrow(/duplicated/);
  });

  test('rejects alias with invalid regex', () => {
    expect(() => base({
      routes: [{
        id: 'r', aliases: ['BAD-Alias'], target: { kind: 'agent', id: 'a' },
      }],
    })).toThrow(/aliases entry/);
  });

  test('rejects unknown target.kind', () => {
    expect(() => base({
      routes: [{ id: 'r', target: { kind: 'widget', id: 'x' } }],
    })).toThrow(/target\.kind must be one of/);
  });

  test('rejects precedence outside [0, 999]', () => {
    expect(() => base({
      routes: [{ id: 'r', target: { kind: 'agent', id: 'a' }, precedence: -1 }],
    })).toThrow(/precedence must be in/);
    expect(() => base({
      routes: [{ id: 'r', target: { kind: 'agent', id: 'a' }, precedence: 1000 }],
    })).toThrow(/precedence must be in/);
  });

  test('missing target → error', () => {
    expect(() => base({
      routes: [{ id: 'r' }],
    })).toThrow(/\.target is required/);
  });
});
