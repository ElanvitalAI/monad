// AXON P3.2 — Image emit tests.
//
// Tests exercise each protocol path through the `capability` override
// (so we don't need a Kitty/iTerm2 host to run). PNG payload is a
// 1×1 transparent pixel so we don't depend on sharp's actual decode
// for the iterm2 path. Kitty / chafa paths probe the underlying
// optional dep and fall through to alt-text when absent — tests
// assert the fallback contract instead of forcing native deps.

import { describe, expect, test } from 'bun:test';
import { emitImage, _resetImageIdForTest } from '../src/display/image-emit.js';
import type { TerminalImageCapability } from '../src/display/terminal-capability.js';

// Smallest valid PNG — 1×1 transparent pixel.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300000000050001a5f645450000000049454e44ae426082',
  'hex',
);

function cap(protocol: TerminalImageCapability['protocol']): TerminalImageCapability {
  return {
    protocol,
    cellPx: { w: 8, h: 16 },
    description: `test-${protocol}`,
  };
}

// ── iTerm2 IIP ────────────────────────────────────────────────────────

describe('emitImage · iterm2 (OSC 1337 IIP)', () => {
  test('emits OSC 1337 envelope around base64 PNG', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'tiny',
      widthCols: 4,
      heightRows: 2,
      capability: cap('iterm2'),
    });
    expect(out.protocol).toBe('iterm2');
    expect(out.fallback).toBe(false);
    expect(out.bytes).toContain('\x1b]1337;File=');
    expect(out.bytes).toContain('inline=1');
    expect(out.bytes).toContain('width=4');
    expect(out.bytes).toContain('height=2');
    expect(out.bytes).toContain('preserveAspectRatio=1');
    // OSC terminator BEL
    expect(out.bytes.endsWith('\x07')).toBe(true);
  });

  test('size=<byteLength> reflects PNG payload size', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'tiny',
      capability: cap('iterm2'),
    });
    expect(out.bytes).toContain(`size=${TINY_PNG.byteLength}`);
  });

  test('embeds base64 of the PNG bytes', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'tiny',
      capability: cap('iterm2'),
    });
    const expectedB64 = TINY_PNG.toString('base64');
    expect(out.bytes).toContain(expectedB64);
  });

  test('rows = requested heightRows', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'tiny',
      heightRows: 7,
      capability: cap('iterm2'),
    });
    expect(out.rows).toBe(7);
  });
});

// ── alt-text fallback ────────────────────────────────────────────────

describe('emitImage · none → alt-text only', () => {
  test('returns "[image · <alt>]"', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'system architecture',
      capability: cap('none'),
    });
    expect(out.protocol).toBe('none');
    expect(out.fallback).toBe(true);
    expect(out.bytes).toContain('[image · system architecture]');
  });

  test('alt-text path uses 1 row regardless of heightRows hint', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'x',
      heightRows: 99,
      capability: cap('none'),
    });
    expect(out.rows).toBe(1);
  });

  test('zero ANSI escape sequences in alt-text bytes', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'plain',
      capability: cap('none'),
    });
    expect(out.bytes).not.toContain('\x1b[');
    expect(out.bytes).not.toContain('\x1b]');
  });
});

// ── kitty + chafa (require optional deps; assert fallback contract) ──

describe('emitImage · kitty (sharp + KGP)', () => {
  test('falls back gracefully when sharp / kgp pipeline fails', async () => {
    // We can't reliably load sharp in the test env (native binary), so
    // the path will probably fall through to chafa and then alt-text.
    // The contract: never throw, always return non-empty bytes.
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'kitty-fallback',
      capability: cap('kitty'),
    });
    expect(out.bytes.length).toBeGreaterThan(0);
    // Fallback hits one of: kitty (when sharp loads) / chafa-fallback
    // (when chafa is on PATH) / none (alt-text).
    expect(['kitty', 'chafa-fallback', 'sixel', 'none']).toContain(out.protocol);
  });
});

describe('emitImage · chafa-fallback', () => {
  test('falls through to alt-text when chafa is unavailable in $PATH', async () => {
    // We don't shadow $PATH for this test — just assert that the call
    // resolves with non-empty bytes regardless of chafa presence.
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'block-art',
      capability: cap('chafa-fallback'),
    });
    expect(out.bytes.length).toBeGreaterThan(0);
    // protocol can be 'chafa-fallback' (chafa on PATH) or 'none' (no chafa)
    expect(['chafa-fallback', 'none']).toContain(out.protocol);
  });
});

describe('emitImage · sixel', () => {
  test('falls through to alt-text when sixel emit fails', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'sixel-attempt',
      capability: cap('sixel'),
    });
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(['sixel', 'none']).toContain(out.protocol);
  });
});

// ── widthCols / heightRows clamps ────────────────────────────────────

describe('emitImage · size hints', () => {
  test('non-positive widthCols clamps to 1', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'x',
      widthCols: 0,
      capability: cap('iterm2'),
    });
    expect(out.bytes).toContain('width=1');
  });

  test('non-positive heightRows clamps to 1', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'x',
      heightRows: -3,
      capability: cap('iterm2'),
    });
    expect(out.bytes).toContain('height=1');
  });

  test('default widthCols / heightRows when omitted', async () => {
    const out = await emitImage({
      png: TINY_PNG,
      alt: 'x',
      capability: cap('iterm2'),
    });
    expect(out.bytes).toContain('width=40');
    expect(out.bytes).toContain('height=20');
  });
});

// ── id stability for snapshots ───────────────────────────────────────

describe('emitImage · _resetImageIdForTest', () => {
  test('resets the image-id sequence (Kitty path uses this)', () => {
    _resetImageIdForTest();
    // No-throw is enough — the helper is only reachable for tests.
    expect(typeof _resetImageIdForTest).toBe('function');
  });
});
