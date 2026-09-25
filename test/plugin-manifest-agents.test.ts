// Tests for `contributes.agents[]` manifest parser (PX-1 Phase 4).

import { describe, expect, test } from 'bun:test';
import { parsePluginManifest } from '../src/plugins/core/manifest.js';

function base(contributes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '0.1.0',
    main: './plugin.ts',
    activationEvents: ['onCommand'],
    contributes,
    capabilities: [],
  };
}

describe('contributes.agents[]', () => {
  test('undefined → contributes.agents undefined', () => {
    const m = parsePluginManifest(base());
    expect(m.contributes.agents).toBeUndefined();
  });

  test('empty array accepted', () => {
    const m = parsePluginManifest(base({ agents: [] }));
    expect(m.contributes.agents).toEqual([]);
  });

  test('inline entry with systemPrompt', () => {
    const m = parsePluginManifest(
      base({
        agents: [
          {
            id: 'explore',
            name: 'Explore',
            description: 'scout',
            systemPrompt: 'BODY',
            model: 'haiku',
            tools: ['Read', 'Glob'],
          },
        ],
      }),
    );
    expect(m.contributes.agents).toHaveLength(1);
    const a = m.contributes.agents![0];
    expect(a.id).toBe('explore');
    expect(a.systemPrompt).toBe('BODY');
    expect(a.tools).toEqual(['Read', 'Glob']);
  });

  test('bodyPath entry without id allowed (id resolves from file stem later)', () => {
    const m = parsePluginManifest(
      base({
        agents: [{ bodyPath: './agents/explore.md' }],
      }),
    );
    expect(m.contributes.agents).toHaveLength(1);
    expect(m.contributes.agents![0].bodyPath).toBe('./agents/explore.md');
    expect(m.contributes.agents![0].id).toBeUndefined();
  });

  test('new omitInheritedContext key takes precedence over omitClaudeMd', () => {
    const m = parsePluginManifest(
      base({
        agents: [{
          id: 'context-precedence',
          systemPrompt: 'BODY',
          omitClaudeMd: true,
          omitInheritedContext: false,
        }],
      }),
    );
    const agent = m.contributes.agents![0]!;
    expect(agent.omitInheritedContext).toBe(false);
    expect('omitClaudeMd' in agent).toBe(false);
  });

  test('inline entry without id rejected', () => {
    expect(() =>
      parsePluginManifest(
        base({ agents: [{ systemPrompt: 'x' }] }),
      ),
    ).toThrow(/inline entry requires id/);
  });

  test('duplicate id rejected', () => {
    expect(() =>
      parsePluginManifest(
        base({
          agents: [
            { id: 'a', systemPrompt: 'x' },
            { id: 'a', systemPrompt: 'y' },
          ],
        }),
      ),
    ).toThrow(/duplicated/);
  });

  test('both systemPrompt and bodyPath rejected', () => {
    expect(() =>
      parsePluginManifest(
        base({
          agents: [{ id: 'a', systemPrompt: 'x', bodyPath: './a.md' }],
        }),
      ),
    ).toThrow(/cannot define both/);
  });

  test('neither systemPrompt nor bodyPath rejected', () => {
    expect(() =>
      parsePluginManifest(
        base({ agents: [{ id: 'a' }] }),
      ),
    ).toThrow(/requires systemPrompt or bodyPath/);
  });

  test('invalid id (uppercase) rejected', () => {
    expect(() =>
      parsePluginManifest(
        base({ agents: [{ id: 'A', systemPrompt: 'x' }] }),
      ),
    ).toThrow(/\[a-z\]\[a-z0-9-\]/);
  });
});
