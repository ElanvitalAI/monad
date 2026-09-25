// PR-S1V.6 (sprint 22 Phase 1 · 2026-04-29) — Microsoft Edge TTS
// provider via the `edge-tts` Python CLI.
//
// Free, no API key, multilingual including Korean. Three Korean voices
// shipped:
//   - `ko-KR-SunHiNeural`        Female · Friendly (default)
//   - `ko-KR-InJoonNeural`       Male   · Friendly
//   - `ko-KR-HyunsuMultilingualNeural`  Male · Multilingual
//
// edge-tts emits MP3, so the pipeline is:
//   text → `edge-tts --write-media tmp.mp3` → sox decode → 24 kHz PCM
// Two subprocesses end-to-end. Same tmpfile pattern as macos-say.
//
// Streaming intentionally not implemented (ROADMAP §2.4) — even though
// edge-tts can write to `/dev/stdout`, the second subprocess (sox MP3
// decode) needs the full file before it knows the output PCM byte
// count, so chunking is synthetic and adds no first-byte latency win.
//
// Reference: ROADMAP §2.4 · edge-tts v7.2.8 verified during Phase 1
// setup.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../../../debug/log.js';
import { isVoiceCostId } from '../../../models/voice-costs.js';
import { globalVoiceCostTracker } from '../../cost-tracker.js';
import {
  DEFAULT_TTS_PCM_FORMAT,
  TTSProviderUnavailableError,
  type EdgeTTSConfig,
  type TTSOpts,
  type TTSPcmFormat,
  type TTSProvider,
  type TTSProviderId,
  type TTSResult,
} from '../tts-provider.js';

const DEFAULT_VOICE = 'ko-KR-SunHiNeural';
const DEFAULT_BINARY = 'edge-tts';
const TARGET_SAMPLE_RATE = 24000;

export class EdgeTTSProvider implements TTSProvider {
  readonly id: TTSProviderId = 'edge-tts';
  readonly format: TTSPcmFormat = DEFAULT_TTS_PCM_FORMAT;

  private readonly defaultVoice: string;
  private readonly binaryPath: string;

  constructor(cfg: EdgeTTSConfig) {
    this.defaultVoice = cfg.voice ?? process.env.EDGE_TTS_VOICE?.trim() ?? DEFAULT_VOICE;
    this.binaryPath = cfg.binaryPath ?? process.env.EDGE_TTS_BIN?.trim() ?? DEFAULT_BINARY;
  }

  async synthesizeBatch(text: string, opts: TTSOpts = {}): Promise<TTSResult> {
    if (!text) {
      throw new Error('EdgeTTSProvider.synthesizeBatch: text is empty');
    }
    const voice = opts.voice ?? this.defaultVoice;
    const dir = await mkdtemp(join(tmpdir(), 'monad-tts-edge-'));
    const mp3Path = join(dir, 'out.mp3');
    try {
      const t0 = Date.now();
      await runEdgeTts({
        binaryPath: this.binaryPath, voice, text, mp3Path,
        speed: opts.speed,
      });
      const pcm = await decodeMp3ToPcm(mp3Path);
      const latencyMs = Date.now() - t0;
      if (pcm.byteLength === 0) {
        throw new Error('edge-tts produced empty PCM after sox decode');
      }
      if (debug.enabled)
        debug.log('voice.tts.edge', 'ok', {
          latencyMs, voice, chars: text.length, pcmBytes: pcm.byteLength,
        });
      this.recordCost(text.length);
      return { pcm, format: this.format, charCount: text.length };
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.tts.edge', 'cleanup-error', { err: String(err) }, { level: 'error' });
      }
    }
  }

  private recordCost(charCount: number): void {
    if (!isVoiceCostId('edge-tts')) {
      // edge-tts is free ($0/char) — registration in voice-costs.ts is
      // what unlocks accurate $0 totals. Until then, log + skip.
      if (debug.enabled)
        debug.log('voice.tts.edge', 'cost.skip-unregistered', { providerId: 'edge-tts' });
      return;
    }
    try {
      globalVoiceCostTracker().recordTts({ providerId: 'edge-tts', charCount });
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.tts.edge', 'cost.error', { err: String(err) }, { level: 'error' });
    }
  }
}

interface RunEdgeTtsOpts {
  binaryPath: string;
  voice: string;
  text: string;
  mp3Path: string;
  speed?: number;
}

function runEdgeTts(opts: RunEdgeTtsOpts): Promise<void> {
  const args = [
    '--voice', opts.voice,
    '--text', opts.text,
    '--write-media', opts.mp3Path,
  ];
  if (typeof opts.speed === 'number' && opts.speed > 0 && opts.speed !== 1) {
    // edge-tts `--rate` is a percentage delta from the default
    // (e.g. "+50%" for 1.5x, "-25%" for 0.75x).
    const pct = Math.round((opts.speed - 1) * 100);
    const rate = pct >= 0 ? `+${pct}%` : `${pct}%`;
    args.push('--rate', rate);
  }
  return new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawn(opts.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(toUnavailableErr(err));
      return;
    }
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`edge-tts exited ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`));
      }
    });
    child.on('error', (err) => reject(toUnavailableErr(err)));
  });
}

function toUnavailableErr(err: unknown): Error {
  const msg = String(err);
  if (msg.includes('ENOENT')) {
    return new TTSProviderUnavailableError(
      'edge-tts',
      'binary not on PATH — install with `pip install edge-tts` or set EDGE_TTS_BIN to its absolute path',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

function decodeMp3ToPcm(mp3Path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('sox', [
        mp3Path,
        '-t', 'raw',
        '-r', String(TARGET_SAMPLE_RATE),
        '-e', 'signed',
        '-b', '16',
        '-c', '1',
        '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`sox mp3-decode exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
      }
    });
    child.on('error', (err) => reject(err));
  });
}

// Used by the optional readFile fallback when sox isn't available.
// Currently unused — kept available so dogfood can swap to a "raw mp3
// playthrough" branch if Bun's spawn pipeline misbehaves under load.
export async function _readMp3FileForTesting(path: string): Promise<Buffer> {
  return await readFile(path);
}
