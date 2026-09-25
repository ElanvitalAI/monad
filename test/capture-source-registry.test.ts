// H6 P6 · CaptureSourceRegistry unit tests.

import { describe, test, expect } from 'bun:test';
import {
  CaptureSourceRegistry,
  buildSourceId,
  parseSourceType,
  defaultCaptureSourceRegistry,
  _resetDefaultCaptureSourceRegistryForTesting,
} from '../src/capture/source-registry.js';
import {
  UnknownCaptureSourceError,
  type CaptureSourceDescriptor,
  type CaptureSourceProvider,
} from '../src/capture/providers/types.js';

function stubProvider(
  type: string,
  descriptors: CaptureSourceDescriptor[],
  opts: { onSnapshot?: (id: string) => void; throwOnList?: boolean } = {},
): CaptureSourceProvider {
  return {
    type,
    list: () => {
      if (opts.throwOnList) throw new Error('boom');
      return descriptors;
    },
    snapshot: async (id) => {
      opts.onSnapshot?.(id);
      return {
        sourceId: id,
        format: 'text',
        body: `snapshot for ${id}`,
        bytes: 12,
        dims: { cols: 80, rows: 24 },
        capturedAt: 0,
        warnings: [],
      };
    },
  };
}

describe('buildSourceId + parseSourceType', () => {
  test('buildSourceId concatenates with colon', () => {
    expect(buildSourceId('vw-pane', '1/p0')).toBe('vw-pane:1/p0');
  });

  test('buildSourceId rejects colon in native id', () => {
    expect(() => buildSourceId('custom', 'has:colon')).toThrow(/must not contain/);
  });

  test('parseSourceType returns the prefix', () => {
    expect(parseSourceType('agent-session:emb-codex-pty-1')).toBe('agent-session');
  });

  test('parseSourceType rejects malformed ids', () => {
    expect(() => parseSourceType('')).toThrow();
    expect(() => parseSourceType('no-colon-here')).toThrow();
    expect(() => parseSourceType(':starts-with-colon')).toThrow();
  });
});

describe('CaptureSourceRegistry · register + list', () => {
  test('register + list round-trip across providers', () => {
    const r = new CaptureSourceRegistry();
    r.registerProvider(stubProvider('type-a', [{
      id: 'type-a:1', type: 'type-a', label: 'a1', formats: ['text'],
    }]));
    r.registerProvider(stubProvider('type-b', [{
      id: 'type-b:1', type: 'type-b', label: 'b1', formats: ['text'],
    }]));
    const list = r.list();
    expect(list.map((d) => d.id).sort()).toEqual(['type-a:1', 'type-b:1']);
  });

  test('duplicate type registration throws', () => {
    const r = new CaptureSourceRegistry();
    r.registerProvider(stubProvider('foo', []));
    expect(() => r.registerProvider(stubProvider('foo', []))).toThrow(/already registered/);
  });

  test('list isolates provider failures (D10)', () => {
    const r = new CaptureSourceRegistry();
    r.registerProvider(stubProvider('good', [{
      id: 'good:1', type: 'good', label: 'ok', formats: ['text'],
    }]));
    r.registerProvider(stubProvider('bad', [], { throwOnList: true }));
    const list = r.list();
    // Good provider still enumerated; bad provider failed silently.
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('good:1');
  });

  test('disposer unregisters the provider', () => {
    const r = new CaptureSourceRegistry();
    const dispose = r.registerProvider(stubProvider('x', [{
      id: 'x:1', type: 'x', label: 'x', formats: ['text'],
    }]));
    expect(r.list()).toHaveLength(1);
    dispose();
    expect(r.list()).toHaveLength(0);
  });
});

describe('CaptureSourceRegistry · snapshot routing', () => {
  test('snapshot dispatches to provider by id prefix', async () => {
    const r = new CaptureSourceRegistry();
    let hit = '';
    r.registerProvider(stubProvider('vw-pane', [{
      id: 'vw-pane:1/p0', type: 'vw-pane', label: '', formats: ['text'],
    }], { onSnapshot: (id) => { hit = id; } }));
    const result = await r.snapshot('vw-pane:1/p0');
    expect(hit).toBe('vw-pane:1/p0');
    expect(result.body).toContain('vw-pane:1/p0');
  });

  test('unknown provider type throws UnknownCaptureSourceError', async () => {
    const r = new CaptureSourceRegistry();
    await expect(r.snapshot('nope:anything')).rejects.toBeInstanceOf(UnknownCaptureSourceError);
  });

  test('countByType aggregates list sizes per provider', () => {
    const r = new CaptureSourceRegistry();
    r.registerProvider(stubProvider('vw-pane', [
      { id: 'vw-pane:1/p0', type: 'vw-pane', label: '', formats: ['text'] },
      { id: 'vw-pane:1/p1', type: 'vw-pane', label: '', formats: ['text'] },
    ]));
    r.registerProvider(stubProvider('agent-session', [
      { id: 'agent-session:s0', type: 'agent-session', label: '', formats: ['text'] },
    ]));
    expect(r.countByType()).toEqual({ 'vw-pane': 2, 'agent-session': 1 });
  });
});

describe('default singleton', () => {
  test('same instance until reset', () => {
    _resetDefaultCaptureSourceRegistryForTesting();
    const a = defaultCaptureSourceRegistry();
    const b = defaultCaptureSourceRegistry();
    expect(a).toBe(b);
    _resetDefaultCaptureSourceRegistryForTesting();
    const c = defaultCaptureSourceRegistry();
    expect(c).not.toBe(a);
  });
});
