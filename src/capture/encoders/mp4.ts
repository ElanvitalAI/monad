// ── IUL Phase V·b — MP4 encoder (ffmpeg-on-PATH) ──
//
// Wraps an external `ffmpeg` CLI to convert a sequence of SVG/ANSI
// frames into a single H.264 MP4. The dependency is **probed**, not
// hard-required — callers with no ffmpeg get a structured error
// (`Mp4UnavailableError`) and can fall back to GIF (Phase V·a) without
// crashing.
//
// Pipeline:
//   1. Each frame → PNG via existing svgToPng (sharp).
//   2. PNGs land in a temp directory `mda-mp4-<rand>/frame-NNNN.png`.
//   3. Spawn `ffmpeg -framerate <fps> -i frame-%04d.png -c:v libx264
//      -pix_fmt yuv420p out.mp4`.
//   4. Read out.mp4, clean up the temp directory, return the buffer.
//
// Fixed-rate is the simplest defense against per-frame delay variance;
// the recorder/capture engine quantizes timestamps to a constant FPS
// before calling this encoder. Variable-frame-rate MP4 (cfr=0) is a
// follow-up.

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { encodeSvg, type SvgThemeTokens } from './svg.js';
import { svgToPng } from './png.js';
import type { CaptureDimensions } from '../types.js';

const execFileAsync = promisify(execFile);

export interface Mp4Frame {
  readonly svg?: string;
  readonly ansi?: string;
  /** 이미 래스터화된 PNG 파일 경로(keyframe 하이라이트릴 — svg/ansi 재래스터 없이 직접 프레임). */
  readonly pngPath?: string;
}

export interface EncodeMp4Opts {
  readonly frames: readonly Mp4Frame[];
  /** Required when frames carry ANSI. */
  readonly dims?: CaptureDimensions;
  /** Output frames per second. Default 10 (fits typical asciicast cadence). */
  readonly fps?: number;
  /** Override codec (default `libx264`). */
  readonly codec?: string;
  /** Override pixel format (default `yuv420p` — required for QuickTime). */
  readonly pixelFormat?: string;
  /** SVG theme override forwarded to encodeSvg. */
  readonly theme?: Partial<SvgThemeTokens>;
  /** Override `ffmpeg` binary path; else `which ffmpeg`. */
  readonly ffmpegPath?: string;
  /** Override which lookup helper (test injection). */
  readonly probe?: () => Promise<string | undefined>;
  /** Override the spawn helper (test injection). */
  readonly spawnProcess?: typeof spawn;
}

export class Mp4UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp4UnavailableError';
  }
}

export class Mp4EncodeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'Mp4EncodeError';
  }
}

/** Returns the resolved ffmpeg path or undefined if not on PATH. Cached
 *  across a single process to avoid the spawn cost on hot paths. */
let _ffmpegPathCache: { value: string | undefined; resolved: boolean } = {
  value: undefined,
  resolved: false,
};

export async function probeFfmpeg(): Promise<string | undefined> {
  if (_ffmpegPathCache.resolved) return _ffmpegPathCache.value;
  try {
    const { stdout } = await execFileAsync(
      process.platform === 'win32' ? 'where' : 'which',
      ['ffmpeg'],
    );
    const path = stdout.trim().split(/\r?\n/)[0];
    _ffmpegPathCache = { value: path || undefined, resolved: true };
  } catch {
    _ffmpegPathCache = { value: undefined, resolved: true };
  }
  return _ffmpegPathCache.value;
}

/** Test-only — invalidate the probe cache. */
export function __resetFfmpegProbeCache(): void {
  _ffmpegPathCache = { value: undefined, resolved: false };
}

export async function encodeMp4(opts: EncodeMp4Opts): Promise<Buffer> {
  if (!opts.frames || opts.frames.length === 0) {
    throw new Mp4EncodeError('encodeMp4: at least one frame required');
  }
  const probe = opts.probe ?? probeFfmpeg;
  const ffmpegPath = opts.ffmpegPath ?? (await probe());
  if (!ffmpegPath) {
    throw new Mp4UnavailableError(
      'encodeMp4: ffmpeg not found on PATH — fall back to GIF (encodeGif) or set opts.ffmpegPath',
    );
  }

  const fps = opts.fps ?? 10;
  const codec = opts.codec ?? 'libx264';
  const pixFmt = opts.pixelFormat ?? 'yuv420p';

  // ── Step 1: frame input → PNG buffers ─────────────────────────
  const pngs = await Promise.all(opts.frames.map(async (frame, idx) => {
    if (frame.pngPath) {
      // 누락/손상 keyframe 파일은 raw ENOENT 대신 구조화 Mp4EncodeError 로(호출자 판정 가능·리뷰 테스트).
      try { return await readFile(frame.pngPath); }
      catch (e) { throw new Mp4EncodeError(`encodeMp4: frame ${idx} pngPath 읽기 실패: ${frame.pngPath}`, e); }
    }
    if (frame.svg) return svgToPng(frame.svg, { background: '#000' });
    if (frame.ansi !== undefined) {
      if (!opts.dims) {
        throw new Mp4EncodeError(`encodeMp4: frame ${idx} ANSI but no dims`);
      }
      return svgToPng(encodeSvg({
        input: frame.ansi,
        cols: opts.dims.cols,
        rows: opts.dims.rows,
        theme: opts.theme,
      }), { background: '#000' });
    }
    throw new Mp4EncodeError(`encodeMp4: frame ${idx} has neither svg, ansi, nor pngPath`);
  }));

  // ── Step 2: write ordered PNGs into a temp dir ─────────────────
  const tmp = await mkdtemp(join(tmpdir(), 'mda-mp4-'));
  try {
    await Promise.all(pngs.map(async (png, i) => {
      const name = `frame-${String(i).padStart(4, '0')}.png`;
      await writeFile(join(tmp, name), png);
    }));
    if (pngs.length === 0) throw new Mp4EncodeError('encodeMp4: no rasterized frames');

    // ── Step 3: spawn ffmpeg ─────────────────────────────────────
    const outPath = join(tmp, 'out.mp4');
    // ★ 공통 해상도 통일(리뷰 must-fix) — 서로 다른 PTY 의 PNG 는 해상도가 다를 수 있어 단일 image2 시퀀스에
    //   그대로 넣으면 libx264 가 프레임 크기 불일치로 실패한다. 전 프레임을 공통 짝수 박스(최대 dims)로
    //   scale(비율 보존)+pad. dims 는 PNG 헤더만 읽어 구함(sharp raster 불요·Pango 무관). 파싱 실패 시 기존
    //   짝수-스케일 폴백(libx264 짝수 요건만 충족).
    const vf = buildScalePadFilter(pngs);
    await runFfmpeg(
      ffmpegPath,
      [
        '-y',
        '-framerate', String(fps),
        '-i', join(tmp, 'frame-%04d.png'),
        '-vf', vf,
        '-c:v', codec,
        '-pix_fmt', pixFmt,
        '-movflags', '+faststart',
        outPath,
      ],
      opts.spawnProcess ?? spawn,
    );
    return await readFile(outPath);
  } catch (err) {
    if (err instanceof Mp4EncodeError || err instanceof Mp4UnavailableError) throw err;
    throw new Mp4EncodeError('encodeMp4: ffmpeg run failed', err);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** PNG signature(8B). */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 실용 해상도 상한 — 손상 파일의 거대 dims 오해석으로 인한 ffmpeg 캔버스 폭주 방지(PNG 스펙 2^31-1 보다 보수적). */
const PNG_MAX_DIM = 100_000;

/** PNG IHDR 에서 width/height 읽기(순수·헤더만·sharp/raster 불요). **전체 signature + IHDR 청크 타입** 검증으로
 *  손상/비-PNG 의 임의 바이트를 dims 로 오해석하지 않는다(리뷰). 상한 초과·무효 시 null. */
export function readPngDims(buf: Buffer): { readonly w: number; readonly h: number } | null {
  // 구조: sig(0-7) · IHDR length(8-11) · "IHDR"(12-15) · width(16-19) · height(20-23) — big-endian uint32.
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w > 0 && h > 0 && w <= PNG_MAX_DIM && h <= PNG_MAX_DIM ? { w, h } : null;
}

/** 프레임들의 공통 짝수 박스(최대 dims)로 scale(비율 보존)+pad 하는 ffmpeg -vf. dims 파싱 실패 시 짝수-스케일 폴백. */
export function buildScalePadFilter(pngs: readonly Buffer[]): string {
  let maxW = 0;
  let maxH = 0;
  for (const p of pngs) { const d = readPngDims(p); if (d) { maxW = Math.max(maxW, d.w); maxH = Math.max(maxH, d.h); } }
  if (maxW === 0 || maxH === 0) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2'; // 폴백(짝수 요건만)
  const w = maxW + (maxW % 2); // libx264 짝수 dims
  const h = maxH + (maxH % 2);
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

function runFfmpeg(
  bin: string,
  args: readonly string[],
  spawnFn: typeof spawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(bin, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', err => reject(new Mp4EncodeError('ffmpeg spawn error', err)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Mp4EncodeError(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Lightweight MP4 sniff (`ftyp` box at offset 4). Useful for tests
 *  that want to assert the encoder produced a real MP4 without a full
 *  decoder dep. */
export function isMp4Buffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return buf.subarray(4, 8).toString('ascii') === 'ftyp';
}
