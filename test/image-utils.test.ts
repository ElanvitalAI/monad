// ── image-utils tests ──
//
// Uses sharp itself to synthesize test images, so we don't need to commit
// binary fixtures. Covers:
//   - magic-byte detection for PNG / JPEG / GIF / WebP
//   - happy-path passthrough when input already fits the caps
//   - dimension clamp at IMAGE_MAX_WIDTH
//   - JPEG ladder kicks in when file is large
//   - PNG+alpha stays as PNG
//   - resize cache returns the identical reference for (path, mtime) hits
//
// Note: `loadImageAsAttachment` memoizes in-process; call `clearImageCache()`
// in the setup for tests that need a fresh encode.

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import {
  detectMediaType,
  resizeImage,
  loadImageAsAttachment,
  clearImageCache,
  IMAGE_MAX_WIDTH,
  TARGET_RAW_BYTES,
} from '../src/image/utils';

const tmpDir = mkdtempSync(join(tmpdir(), 'elanous-img-'));
const created: string[] = [];

function tmpPath(name: string): string {
  const p = join(tmpDir, name);
  created.push(p);
  return p;
}

afterAll(() => {
  for (const p of created) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => clearImageCache());

// ═══════════════════════════════════════════
// 1. detectMediaType
// ═══════════════════════════════════════════

describe('detectMediaType', () => {
  test('PNG magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMediaType(buf)).toBe('image/png');
  });

  test('JPEG magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectMediaType(buf)).toBe('image/jpeg');
  });

  test('GIF magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectMediaType(buf)).toBe('image/gif');
  });

  test('WebP magic bytes (RIFF..WEBP)', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,  // RIFF
      0x00, 0x00, 0x00, 0x00,  // size placeholder
      0x57, 0x45, 0x42, 0x50,  // WEBP
    ]);
    expect(detectMediaType(buf)).toBe('image/webp');
  });

  test('unknown bytes fall back to image/png', () => {
    expect(detectMediaType(Buffer.from([0, 0, 0, 0]))).toBe('image/png');
  });

  test('buffer shorter than 4 bytes returns image/png', () => {
    expect(detectMediaType(Buffer.from([0xff]))).toBe('image/png');
  });
});

// ═══════════════════════════════════════════
// 2. resizeImage
// ═══════════════════════════════════════════

describe('resizeImage', () => {
  test('small PNG within caps passes through untransformed', async () => {
    // 50×50 opaque red PNG — tiny, should round-trip unchanged.
    const small = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();

    const res = await resizeImage(small);
    expect(res.transformed).toBe(false);
    expect(res.width).toBe(50);
    expect(res.height).toBe(50);
    expect(res.mediaType).toBe('image/png');
    // passthrough preserves the exact same buffer
    expect(res.buf.length).toBe(small.length);
  });

  test('oversized PNG is clamped to IMAGE_MAX_WIDTH (aspect preserved)', async () => {
    // 3200×1600 — exceeds the 1568 width cap. Opaque so JPEG path can kick in
    // if byte cap also exceeded; we just check the dimensional clamp here.
    const wide = await sharp({
      create: { width: 3200, height: 1600, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();

    const res = await resizeImage(wide);
    expect(res.transformed).toBe(true);
    expect(res.width).toBeLessThanOrEqual(IMAGE_MAX_WIDTH);
    // 3200:1600 == 2:1 → 1568:784
    expect(res.width).toBe(IMAGE_MAX_WIDTH);
    expect(res.height).toBe(Math.round(1600 * IMAGE_MAX_WIDTH / 3200));
    expect(res.buf.length).toBeLessThanOrEqual(TARGET_RAW_BYTES);
  });

  test('transparent PNG keeps PNG output when possible', async () => {
    // Solid color with alpha=128 — forces 4-channel encoding.
    const transparent = await sharp({
      create: {
        width: 400, height: 400, channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 0.5 },
      },
    }).png().toBuffer();

    const res = await resizeImage(transparent);
    expect(res.mediaType).toBe('image/png');
  });

  test('large noisy image falls back to JPEG ladder', async () => {
    // Random noise at 3000×2000 — incompressible, forces byte-cap ladder.
    const pixels = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
    const noisy = await sharp(pixels, {
      raw: { width: 3000, height: 2000, channels: 3 },
    }).png().toBuffer();

    const res = await resizeImage(noisy);
    expect(res.transformed).toBe(true);
    expect(res.buf.length).toBeLessThanOrEqual(TARGET_RAW_BYTES);
    expect(res.width).toBeLessThanOrEqual(IMAGE_MAX_WIDTH);
    // An opaque-PNG→byte-cap scenario should end up as JPEG after the ladder.
    expect(res.mediaType).toBe('image/jpeg');
  });
});

// ═══════════════════════════════════════════
// 3. loadImageAsAttachment + cache
// ═══════════════════════════════════════════

describe('loadImageAsAttachment', () => {
  test('returns base64 + dimensions for a valid PNG', async () => {
    const p = tmpPath('ok.png');
    const buf = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 0, g: 128, b: 255 } },
    }).png().toBuffer();
    writeFileSync(p, buf);

    const res = await loadImageAsAttachment(p);
    expect(res.mediaType).toBe('image/png');
    expect(res.dimensions).toEqual({ w: 100, h: 80 });
    expect(res.base64.length).toBeGreaterThan(0);
    // base64 decodes to the reported sizeBytes
    expect(Buffer.from(res.base64, 'base64').length).toBe(res.sizeBytes);
  });

  test('caches by (path + mtime) — second call returns same object', async () => {
    const p = tmpPath('cache.png');
    const buf = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).png().toBuffer();
    writeFileSync(p, buf);

    const a = await loadImageAsAttachment(p);
    const b = await loadImageAsAttachment(p);
    expect(b).toBe(a);  // reference equality == cache hit
  });

  test('mtime bump invalidates cache', async () => {
    const p = tmpPath('bump.png');
    const buf = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();
    writeFileSync(p, buf);

    const a = await loadImageAsAttachment(p);

    // Bump mtime ~2 seconds into the future — utimesSync has second resolution
    // on some filesystems, so a sub-second bump may round back to the same
    // integer mtimeMs and falsely hit the cache.
    const future = Date.now() / 1000 + 2;
    utimesSync(p, future, future);

    const b = await loadImageAsAttachment(p);
    expect(b).not.toBe(a);
  });
});
