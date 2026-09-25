// End-to-end test for the KGP render pipeline. Uses a real 16x16 PNG
// round-tripped through sharp so we exercise the decode + resize path
// the same way production does. The test doesn't verify pixel-perfect
// byte equality against yazi (too brittle across sharp/image-rs
// filter differences); it verifies the *contract* — imageId stability,
// placeholder dimensions, cache behaviour, cleanup sequence.

import { describe, test, expect, beforeAll, afterAll, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { renderImageKGP, _resetForTest } from '../../src/kgp/pipeline.js';

let tmpDir: string;
let redPng: string;
let bluePng: string;

// The pipeline checks `process.env.TMUX` at render time to decide
// whether to wrap the APC stream in the tmux passthrough DCS. Tests
// that assert on the raw `\x1b_G` prefix must run WITHOUT that env
// var — otherwise they're environment-dependent and fail whenever the
// test process inherits TMUX from a parent shell (the symptom the
// pre-2026-04-21 handoff flagged as "renderImageKGP flake"). Save +
// restore the env var around each test in this file.
let savedTmuxEnv: string | undefined;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kgp-pipe-'));
  // Generate two small PNGs with sharp — smaller than any reasonable
  // preview rect, so the resizer's withoutEnlargement:true keeps them
  // at native size.
  redPng = join(tmpDir, 'red.png');
  bluePng = join(tmpDir, 'blue.png');
  await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toFile(redPng);
  await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toFile(bluePng);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  savedTmuxEnv = process.env.TMUX;
  delete process.env.TMUX;
});

afterEach(() => {
  _resetForTest();
  if (savedTmuxEnv !== undefined) process.env.TMUX = savedTmuxEnv;
  else delete process.env.TMUX;
});

describe('renderImageKGP — happy path (non-tmux env)', () => {
  test('returns upload + placeholder + cleanup for a real PNG', async () => {
    const r = await renderImageKGP(redPng, { rows: 8, cols: 16 });
    expect(r).not.toBeNull();
    expect(r!.uploadBytes.startsWith('\x1b_G')).toBe(true);
    expect(r!.uploadBytes.endsWith('\x1b\\')).toBe(true);
    expect(r!.placeholderLines.length).toBeGreaterThan(0);
    expect(r!.cleanupSeq).toContain('a=d,d=I');
    expect(r!.imageId).toBeGreaterThan(0);
  });

  test('placeholder grid fits inside the requested rect', async () => {
    const rows = 4, cols = 8;
    const r = await renderImageKGP(redPng, { rows, cols });
    expect(r).not.toBeNull();
    expect(r!.renderedRows).toBeLessThanOrEqual(rows);
    expect(r!.renderedCols).toBeLessThanOrEqual(cols);
    expect(r!.placeholderLines.length).toBe(r!.renderedRows);
  });

  test('imageId is deterministic for same path + mtime', async () => {
    const a = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    _resetForTest();
    const b = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    expect(a!.imageId).toBe(b!.imageId);
  });

  test('different files get different imageIds', async () => {
    const a = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    const b = await renderImageKGP(bluePng, { rows: 4, cols: 8 });
    expect(a!.imageId).not.toBe(b!.imageId);
  });

  test('cleanupSeq references the correct image id', async () => {
    const r = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    expect(r!.cleanupSeq).toContain(`i=${r!.imageId}`);
  });
});

describe('renderImageKGP — caching', () => {
  test('second call with same key is cached (object identity)', async () => {
    const a = await renderImageKGP(redPng, { rows: 6, cols: 10 });
    const b = await renderImageKGP(redPng, { rows: 6, cols: 10 });
    // Same object reference out of the cache map.
    expect(a).toBe(b);
  });

  test('different rows/cols → fresh render', async () => {
    const a = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    const b = await renderImageKGP(redPng, { rows: 8, cols: 16 });
    expect(a).not.toBe(b);
    // imageId is derived from path+mtime so it stays the same across
    // resolutions — only the placeholder grid shape changes.
    expect(a!.imageId).toBe(b!.imageId);
  });
});

describe('renderImageKGP — error paths', () => {
  test('missing file returns null', async () => {
    const r = await renderImageKGP('/nonexistent/does-not-exist.png', { rows: 4, cols: 8 });
    expect(r).toBeNull();
  });

  test('not-an-image returns null', async () => {
    const garbage = join(tmpDir, 'garbage.png');
    writeFileSync(garbage, 'this is not a png');
    const r = await renderImageKGP(garbage, { rows: 4, cols: 8 });
    expect(r).toBeNull();
  });
});

describe('renderImageKGP — tmux passthrough', () => {
  // Top-level beforeEach/afterEach (above) already snapshot + restore
  // process.env.TMUX around every test in this file, so individual
  // tests here only need to set or clear the env var for their own
  // scenario without worrying about leakage.

  test('under $TMUX, upload + cleanup are DCS-wrapped', async () => {
    process.env.TMUX = '/tmp/tmux-501/default,12345,0';
    _resetForTest();
    const r = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    expect(r).not.toBeNull();
    // DCS envelope: starts with `\x1bPtmux;`, ends with `\x1b\\`.
    expect(r!.uploadBytes.startsWith('\x1bPtmux;')).toBe(true);
    expect(r!.uploadBytes.endsWith('\x1b\\')).toBe(true);
    expect(r!.cleanupSeq.startsWith('\x1bPtmux;')).toBe(true);
    expect(r!.cleanupSeq.endsWith('\x1b\\')).toBe(true);
  });

  test('without $TMUX, sequences are raw APC', async () => {
    delete process.env.TMUX;
    _resetForTest();
    const r = await renderImageKGP(redPng, { rows: 4, cols: 8 });
    expect(r).not.toBeNull();
    expect(r!.uploadBytes.startsWith('\x1b_G')).toBe(true);
    expect(r!.cleanupSeq.startsWith('\x1b_G')).toBe(true);
  });
});
