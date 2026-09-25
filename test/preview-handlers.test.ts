import { describe, expect, test } from 'bun:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPdf } from '../src/preview/handlers/pdf.js';
import { runSvg } from '../src/preview/handlers/svg.js';
import { runVideo } from '../src/preview/handlers/video.js';
import { runFont } from '../src/preview/handlers/font.js';
import { runImage } from '../src/preview/handlers/image.js';
import type { HandlerDeps } from '../src/preview/handlers/common.js';

// ── Fake DI helpers ──────────────────────────────────────────────
interface SpawnRecord { cmd: string; args: string[] }
function mkDeps(opts: {
  which: (cmd: string) => string | null;
  status?: number;
  stderr?: string;
  stdout?: string;
  exists?: (path: string) => boolean;
}): [Required<HandlerDeps>, SpawnRecord[]] {
  const calls: SpawnRecord[] = [];
  const deps = {
    which: opts.which,
    spawn: (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return {
        status: opts.status ?? 0,
        stderr: opts.stderr ?? '',
        stdout: opts.stdout ?? '',
      };
    },
    exists: opts.exists ?? (() => false),
  };
  return [deps, calls];
}

const tmp = mkdtempSync(join(tmpdir(), 'preview-handlers-'));
function tmpFile(name: string): string {
  const p = join(tmp, name);
  writeFileSync(p, 'x');
  return p;
}

// ── PDF ──────────────────────────────────────────────────────────
describe('runPdf', () => {
  test('missing pdftoppm → install hint lines', () => {
    const f = tmpFile('a.pdf');
    const [deps] = mkDeps({ which: () => null });
    const r = runPdf(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install poppler'))).toBe(true);
  });

  test('cache hit short-circuits spawn', () => {
    const f = tmpFile('b.pdf');
    const [deps, calls] = mkDeps({
      which: () => '/usr/local/bin/pdftoppm',
      exists: () => true,
    });
    const r = runPdf(f, { skip: 0 }, deps);
    expect(r.kind).toBe('image');
    expect(calls).toHaveLength(0);
  });

  test('invokes pdftoppm with correct page args', () => {
    const f = tmpFile('c.pdf');
    const [deps, calls] = mkDeps({ which: () => '/bin/pdftoppm' });
    runPdf(f, { skip: 2 }, deps);
    expect(calls).toHaveLength(1);
    const args = calls[0]!.args;
    expect(args).toContain('-f');
    expect(args).toContain('3');  // page = skip + 1
    expect(args).toContain('-singlefile');
    expect(args).toContain('-jpeg');
  });

  test('spawn failure → error lines with stderr', () => {
    const f = tmpFile('d.pdf');
    const [deps] = mkDeps({
      which: () => '/bin/pdftoppm',
      status: 1,
      stderr: 'Syntax Error: bad file',
    });
    const r = runPdf(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('pdftoppm failed'))).toBe(true);
    expect(r.lines.some(l => l.includes('Syntax Error'))).toBe(true);
  });
});

// ── SVG ──────────────────────────────────────────────────────────
describe('runSvg', () => {
  test('prefers rsvg-convert when available', () => {
    const f = tmpFile('a.svg');
    const [deps, calls] = mkDeps({
      which: (cmd) => cmd === 'rsvg-convert' ? '/bin/rsvg-convert' : null,
    });
    const r = runSvg(f, {}, deps);
    expect(r.kind).toBe('image');
    expect(calls[0]!.cmd).toBe('/bin/rsvg-convert');
    expect(calls[0]!.args).toContain('-w');
    expect(calls[0]!.args).toContain('-b');
  });

  test('falls back to magick when rsvg missing', () => {
    const f = tmpFile('b.svg');
    const [deps, calls] = mkDeps({
      which: (cmd) => cmd === 'magick' ? '/bin/magick' : null,
    });
    const r = runSvg(f, {}, deps);
    expect(r.kind).toBe('image');
    expect(calls[0]!.cmd).toBe('/bin/magick');
  });

  test('neither tool → install hint (rsvg preferred)', () => {
    const f = tmpFile('c.svg');
    const [deps] = mkDeps({ which: () => null });
    const r = runSvg(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install librsvg'))).toBe(true);
  });
});

// ── Video ────────────────────────────────────────────────────────
describe('runVideo', () => {
  test('missing ffmpegthumbnailer → install hint', () => {
    const f = tmpFile('a.mp4');
    const [deps] = mkDeps({ which: () => null });
    const r = runVideo(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install ffmpegthumbnailer'))).toBe(true);
  });

  test('skip=0 → 10% timestamp; skip=3 → 40%', () => {
    const f = tmpFile('b.mp4');
    const runs: number[] = [];
    for (const skip of [0, 3]) {
      const [deps, calls] = mkDeps({ which: () => '/bin/ffmpegthumbnailer' });
      runVideo(f, { skip }, deps);
      const tArg = calls[0]!.args[calls[0]!.args.indexOf('-t') + 1]!;
      runs.push(parseInt(tArg, 10));
    }
    expect(runs).toEqual([10, 40]);
  });

  test('skip saturates at 90%', () => {
    const f = tmpFile('c.mp4');
    const [deps, calls] = mkDeps({ which: () => '/bin/ffmpegthumbnailer' });
    runVideo(f, { skip: 100 }, deps);
    const tArg = calls[0]!.args[calls[0]!.args.indexOf('-t') + 1]!;
    expect(parseInt(tArg, 10)).toBe(90);
  });
});

// ── Font ─────────────────────────────────────────────────────────
describe('runFont', () => {
  test('missing magick → install hint', () => {
    const f = tmpFile('a.ttf');
    const [deps] = mkDeps({ which: () => null });
    const r = runFont(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install imagemagick'))).toBe(true);
  });

  test('passes the font file via -font', () => {
    const f = tmpFile('b.otf');
    const [deps, calls] = mkDeps({ which: () => '/bin/magick' });
    runFont(f, {}, deps);
    const args = calls[0]!.args;
    const fontIdx = args.indexOf('-font');
    expect(fontIdx).toBeGreaterThanOrEqual(0);
    expect(args[fontIdx + 1]).toBe(f);
  });
});

// ── Image (magick transcoding branch) ────────────────────────────
describe('runImage', () => {
  test('PNG passes through without touching magick', () => {
    const f = tmpFile('a.png');
    const [deps, calls] = mkDeps({ which: () => null });  // would fail if called
    const r = runImage(f, {}, deps);
    expect(r.kind).toBe('image');
    if (r.kind !== 'image') throw new Error('unreachable');
    expect(r.cachePath).toBe(f);
    expect(calls).toHaveLength(0);
  });

  test('AVIF routes through magick transcoding', () => {
    const f = tmpFile('b.avif');
    const [deps, calls] = mkDeps({ which: () => '/bin/magick' });
    const r = runImage(f, {}, deps);
    expect(r.kind).toBe('image');
    expect(calls).toHaveLength(1);
    const args = calls[0]!.args;
    expect(args[0]).toBe(f);
    expect(args).toContain('-thumbnail');
  });

  test('HEIC without magick → install hint', () => {
    const f = tmpFile('c.heic');
    const [deps] = mkDeps({ which: () => null });
    const r = runImage(f, {}, deps);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('brew install imagemagick'))).toBe(true);
  });

  test('JXL cache hit → no spawn', () => {
    const f = tmpFile('d.jxl');
    const [deps, calls] = mkDeps({
      which: () => '/bin/magick',
      exists: () => true,
    });
    runImage(f, {}, deps);
    expect(calls).toHaveLength(0);
  });
});
