// H6 P6 · LLM tool contract tests.

import { describe, test, expect } from 'bun:test';
import {
  buildListCaptureSourcesTool,
  buildSnapshotSourceTool,
  dispatchListCaptureSources,
  dispatchSnapshotSource,
  initCaptureSourceTools,
} from '../src/skills/tools/capture-source.js';
import { CaptureSourceRegistry } from '../src/capture/source-registry.js';
import type { CaptureSourceProvider } from '../src/capture/providers/types.js';
import {
  buildBrowserObservationInputSourceRef,
  buildTerminalObservationInputSourceRef,
} from '../src/input/input-source-kind.js';

function stubProvider(
  type: string,
  opts: { listReturns?: boolean } = {},
): CaptureSourceProvider {
  return {
    type,
    list: () => opts.listReturns === false ? [] : [{
      id: `${type}:native-1`,
      type,
      label: `${type} label`,
      summary: 'stub summary',
      formats: ['text'],
      sourceRef: type === 'browser-cdp'
        ? buildBrowserObservationInputSourceRef({
            provider: 'cdp',
            capabilities: ['observe', 'verify'],
          })
        : buildTerminalObservationInputSourceRef({
            provider: 'tui',
            deviceId: 'vw-1',
            sessionId: 'p0',
            capabilities: ['observe', 'render'],
          }),
    }],
    snapshot: async (id, callOpts) => ({
      sourceId: id,
      format: callOpts.format ?? 'text',
      body: 'stub-body',
      bytes: 9,
      dims: callOpts.dims ?? { cols: 80, rows: 24 },
      capturedAt: 42,
      warnings: [],
      sourceRef: type === 'browser-cdp'
        ? buildBrowserObservationInputSourceRef({
            provider: 'cdp',
            capabilities: ['observe', 'verify'],
          })
        : buildTerminalObservationInputSourceRef({
            provider: 'tui',
            deviceId: 'vw-1',
            sessionId: 'p0',
            capabilities: ['observe', 'render'],
          }),
    }),
  };
}

describe('buildListCaptureSourcesTool spec', () => {
  test('name + schema · no required params', () => {
    const spec = buildListCaptureSourcesTool();
    expect(spec.name).toBe('ListCaptureSources');
    const params = spec.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(params.properties).toEqual({});
    expect(params.required).toBeUndefined();
  });
});

describe('buildSnapshotSourceTool spec', () => {
  test('requires sourceId', () => {
    const spec = buildSnapshotSourceTool();
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toContain('sourceId');
  });

  test('format enum includes text/ansi/png/svg/asciicast', () => {
    const spec = buildSnapshotSourceTool();
    const props = spec.parameters as { properties: { format: { enum?: string[] } } };
    expect(props.properties.format.enum).toEqual(
      expect.arrayContaining(['text', 'ansi', 'png', 'svg', 'asciicast']),
    );
  });
});

describe('dispatchListCaptureSources', () => {
  test('empty registry · structured empty metadata', async () => {
    const registry = new CaptureSourceRegistry();
    const r = await dispatchListCaptureSources({}, registry);
    expect(r.metadata.sources).toEqual([]);
    expect(r.metadata.countByType).toEqual({});
    expect(r.output).toMatch(/no live sources/);
  });

  test('populated · metadata shape with countByType + registeredTypes', async () => {
    const registry = new CaptureSourceRegistry();
    registry.registerProvider(stubProvider('vw-pane'));
    registry.registerProvider(stubProvider('agent-session'));
    const r = await dispatchListCaptureSources({}, registry);
    expect(r.metadata.sources).toHaveLength(2);
    expect(r.metadata.countByType['vw-pane']).toBe(1);
    expect(r.metadata.countByType['agent-session']).toBe(1);
    expect(r.metadata.registeredTypes.sort()).toEqual(['agent-session', 'vw-pane']);
    expect(r.metadata.sources[0]?.sourceRef).toBeDefined();
  });
});

describe('dispatchSnapshotSource · validation', () => {
  test('missing sourceId · isError', async () => {
    const r = await dispatchSnapshotSource({});
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/sourceId required/);
  });

  test('unknown source id · isError wrapping registry UnknownCaptureSourceError', async () => {
    const registry = new CaptureSourceRegistry();
    const r = await dispatchSnapshotSource({ sourceId: 'nope:x' }, registry);
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/unknown source/);
  });
});

describe('dispatchSnapshotSource · happy path', () => {
  test('routes through registry · metadata shape complete', async () => {
    const registry = new CaptureSourceRegistry();
    registry.registerProvider(stubProvider('stub'));
    const r = await dispatchSnapshotSource({ sourceId: 'stub:native-1' }, registry);
    expect(r.isError).toBeUndefined();
    expect(r.metadata.sourceId).toBe('stub:native-1');
    expect(r.metadata.format).toBe('text');
    expect(r.metadata.bytes).toBe(9);
    expect(r.metadata.warnings).toEqual([]);
    expect(r.metadata.sourceRef).toEqual({
      kind: 'terminal',
      provider: 'tui',
      deviceId: 'vw-1',
      sessionId: 'p0',
      capabilities: ['observe', 'render'],
    });
    // Output body renders the stub content.
    expect(r.output).toContain('stub-body');
  });

  test('format override passes through to provider', async () => {
    const registry = new CaptureSourceRegistry();
    let received = '';
    registry.registerProvider({
      ...stubProvider('stub'),
      snapshot: async (id, opts) => {
        received = opts.format ?? '';
        return {
          sourceId: id, format: opts.format ?? 'text', body: '',
          bytes: 0, dims: { cols: 0, rows: 0 }, capturedAt: 0, warnings: [],
        };
      },
    });
    await dispatchSnapshotSource({ sourceId: 'stub:native-1', format: 'ansi' }, registry);
    expect(received).toBe('ansi');
  });
});

describe('initCaptureSourceTools bootstrap', () => {
  test('no-op idempotent', () => {
    expect(() => {
      initCaptureSourceTools();
      initCaptureSourceTools();
    }).not.toThrow();
  });
});
