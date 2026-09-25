// H6 P6 · /capture slash parser + routing.

import { describe, test, expect } from 'bun:test';
import { executeCaptureSourceSlash } from '../src/skills/tools/capture-source-slash.js';
import {
  defaultCaptureSourceRegistry,
  _resetDefaultCaptureSourceRegistryForTesting,
} from '../src/capture/source-registry.js';

describe('/capture help + routing', () => {
  test('no args · help output', async () => {
    const r = await executeCaptureSourceSlash({ name: 'capture', args: [] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/\/capture/);
  });

  test('help subcommand renders usage', async () => {
    const r = await executeCaptureSourceSlash({ name: 'capture', args: ['help'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.some((l) => l.includes('<type>:<native>'))).toBe(true);
  });

  test('mis-routed slash · returns null', async () => {
    const r = await executeCaptureSourceSlash({ name: 'other', args: [] });
    expect(r).toBeNull();
  });

  test('unknown subcommand · error', async () => {
    const r = await executeCaptureSourceSlash({ name: 'capture', args: ['nope'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/unknown subcommand/);
  });
});

describe('/capture list (default registry)', () => {
  test('empty registry · "no live sources" message', async () => {
    _resetDefaultCaptureSourceRegistryForTesting();
    defaultCaptureSourceRegistry();
    const r = await executeCaptureSourceSlash({ name: 'capture', args: ['list'] });
    expect(r?.ok).toBe(true);
    expect(r?.logLines.join('\n')).toMatch(/no live sources/);
  });
});

describe('/capture snapshot parser', () => {
  test('missing sourceId · usage error', async () => {
    const r = await executeCaptureSourceSlash({ name: 'capture', args: ['snapshot'] });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/sourceId required/);
  });

  test('--format with unknown value · error', async () => {
    const r = await executeCaptureSourceSlash({
      name: 'capture',
      args: ['snapshot', '--format', 'bogus', 'vw-pane:1/p0'],
    });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/--format/);
  });

  test('--cols without --rows · error', async () => {
    const r = await executeCaptureSourceSlash({
      name: 'capture',
      args: ['snapshot', '--cols', '100', 'vw-pane:1/p0'],
    });
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/--cols and --rows/);
  });

  test('unknown source · dispatch error surfaces', async () => {
    _resetDefaultCaptureSourceRegistryForTesting();
    const r = await executeCaptureSourceSlash({
      name: 'capture',
      args: ['snapshot', 'nope:anything'],
    });
    expect(r?.ok).toBe(false);
    expect(r?.logLines.join('\n')).toMatch(/unknown source/);
  });
});
