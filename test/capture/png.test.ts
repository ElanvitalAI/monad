// ── Capture Phase 0.5 — PNG encoder tests ──

import { describe, expect, test } from 'bun:test';

import { captureImage, svgToPng } from '../../src/capture/index.js';

describe('svgToPng', () => {
  test('produces PNG with valid magic bytes', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20">'
      + '<rect width="50" height="20" fill="#123456"/></svg>';
    const png = await svgToPng(svg);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);  // P
    expect(png[2]).toBe(0x4e);  // N
    expect(png[3]).toBe(0x47);  // G
    expect(png.byteLength).toBeGreaterThan(20);
  });

  test('width resize option shrinks output', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">'
      + '<rect width="200" height="80" fill="#ff0000"/></svg>';
    const full = await svgToPng(svg);
    const shrunk = await svgToPng(svg, { width: 50 });
    expect(shrunk.byteLength).toBeLessThan(full.byteLength);
  });

  test('background flatten removes alpha channel', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
      + '<circle cx="5" cy="5" r="4" fill="#000"/></svg>';
    const png = await svgToPng(svg, { background: '#ffffff' });
    // Just confirm non-zero buffer + magic bytes.
    expect(png.byteLength).toBeGreaterThan(20);
    expect(png[0]).toBe(0x89);
  });
});

describe('captureImage({format:png})', () => {
  test('returns PNG bytes in bodyBytes', async () => {
    const result = await captureImage({
      target: { kind: 'stream' },
      format: 'png',
      dims: { cols: 80, rows: 24 },
      source: () => '\x1b[32mHello\x1b[0m World',
      title: 'png-test',
    });
    expect(result.format).toBe('png');
    expect(result.body).toBe('');  // PNG carries via bodyBytes
    expect(result.bodyBytes[0]).toBe(0x89);
    expect(result.bodyBytes[1]).toBe(0x50);
    expect(result.bytes).toBe(result.bodyBytes.byteLength);
  });

  test('svg format via captureImage returns identical body as sync', async () => {
    const syncArg = {
      target: { kind: 'stream' } as const,
      format: 'svg' as const,
      dims: { cols: 80, rows: 24 },
      source: () => 'same-source',
      now: () => 42,
    };
    const { capture } = await import('../../src/capture/index.js');
    const sync = capture(syncArg);
    const async = await captureImage(syncArg);
    expect(async.body).toBe(sync.body);
    expect(async.bodyBytes.toString('utf8')).toBe(sync.body);
  });

  test('captureImage for text format mirrors sync', async () => {
    const result = await captureImage({
      target: { kind: 'stream' },
      format: 'text',
      dims: { cols: 20, rows: 2 },
      source: () => 'hi',
      now: () => 100,
    });
    expect(result.format).toBe('text');
    expect(result.body).toBe('hi');
    expect(result.capturedAt).toBe(100);
  });
});
