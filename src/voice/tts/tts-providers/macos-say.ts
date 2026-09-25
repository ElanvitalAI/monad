// PR-S1V.6 (sprint 22 Phase 1 · 2026-04-29) — macOS `say` TTS provider.
//
// System fallback for environments without an API key or network.
// Uses the `say` command with `--data-format=LEI16@24000 --file-format=WAVE`
// to write a WAV to a tmp file, reads the file, strips the 44-byte WAV
// header, and returns raw PCM matching `audio-player.ts`'s contract.
//
// Korean voice: `Yuna` (default · verified `say -v '?' | grep ko_KR`
// during Phase 1 setup). Eight other Korean voices ship with macOS:
// Eddy / Flo / Grandma / Grandpa / Reed / Rocko / Sandy / Shelley.
//
// Streaming is intentionally not implemented — `say` writes the full
// WAV after synthesis completes, so any "stream" wrapper would be
// synthetic chunking. ROADMAP §2.6 calls this out: batch only.
//
// Reference: ROADMAP §2.6 · `man say`.

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
  type MacosSayConfig,
  type TTSOpts,
  type TTSPcmFormat,
  type TTSProvider,
  type TTSProviderId,
  type TTSResult,
} from '../tts-provider.js';

const DEFAULT_VOICE = 'Yuna';
const WAV_HEADER_BYTES = 44;
const SAY_BASELINE_WPM = 175;

export class MacosSayProvider implements TTSProvider {
  readonly id: TTSProviderId = 'macos-say';
  readonly format: TTSPcmFormat = DEFAULT_TTS_PCM_FORMAT;

  private readonly defaultVoice: string;

  constructor(cfg: MacosSayConfig) {
    if (process.platform !== 'darwin') {
      throw new TTSProviderUnavailableError(
        'macos-say',
        'macos-say is only available on macOS — use openai-tts / edge-tts / elevenlabs-tts on other platforms',
      );
    }
    this.defaultVoice = cfg.voice ?? process.env.MACOS_SAY_VOICE?.trim() ?? DEFAULT_VOICE;
  }

  async synthesizeBatch(text: string, opts: TTSOpts = {}): Promise<TTSResult> {
    if (!text) {
      throw new Error('MacosSayProvider.synthesizeBatch: text is empty');
    }
    const voice = opts.voice ?? this.defaultVoice;
    const dir = await mkdtemp(join(tmpdir(), 'monad-tts-say-'));
    const wavPath = join(dir, 'out.wav');
    try {
      const t0 = Date.now();
      await runSay({ voice, text, speed: opts.speed, outPath: wavPath });
      const wav = await readFile(wavPath);
      const latencyMs = Date.now() - t0;
      if (wav.byteLength <= WAV_HEADER_BYTES) {
        throw new Error(`macos-say produced empty WAV (${wav.byteLength} bytes)`);
      }
      const pcm = wav.subarray(WAV_HEADER_BYTES);
      if (debug.enabled)
        debug.log('voice.tts.macos', 'ok', {
          latencyMs, voice, chars: text.length, pcmBytes: pcm.byteLength,
        });
      this.recordCost(text.length);
      return { pcm: Buffer.from(pcm), format: this.format, charCount: text.length };
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.tts.macos', 'cleanup-error', { err: String(err) }, { level: 'error' });
      }
    }
  }

  private recordCost(charCount: number): void {
    if (!isVoiceCostId('macos-say')) return;
    try {
      globalVoiceCostTracker().recordTts({ providerId: 'macos-say', charCount });
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.tts.macos', 'cost.error', { err: String(err) }, { level: 'error' });
    }
  }
}

interface RunSayOpts {
  voice: string;
  text: string;
  speed?: number;
  outPath: string;
}

function runSay(opts: RunSayOpts): Promise<void> {
  const args: string[] = [
    '-v', opts.voice,
    '--data-format=LEI16@24000',
    '--file-format=WAVE',
    '-o', opts.outPath,
  ];
  // `say -r` is words per minute. Map our 0.5..2.0 speed multiplier
  // onto the system baseline (~175 wpm) so the same `opts.speed` shape
  // works across all four providers.
  if (typeof opts.speed === 'number' && opts.speed > 0) {
    const wpm = Math.round(SAY_BASELINE_WPM * opts.speed);
    args.push('-r', String(wpm));
  }
  args.push(opts.text);
  return new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawn('say', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`say exited ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
      }
    });
    child.on('error', (err) => reject(err));
  });
}
