// Phase 1 dogfood CLI · ROADMAP §2.8 — synthesize a Korean utterance
// with each TTS provider and compare pronunciation / latency.
//
// Usage:
//   bun scripts/tts-test.ts "안녕하세요 monad-agent"
//   bun scripts/tts-test.ts "..." --provider edge-tts
//   bun scripts/tts-test.ts "..." --provider openai-tts --hd --voice nova
//   bun scripts/tts-test.ts "..." --provider macos-say --no-play --output /tmp/say.pcm
//   bun scripts/tts-test.ts "..." --provider elevenlabs-tts --voice 21m00Tcm4TlvDq8ikWAM
//
// Streams PCM to the system audio device by default (sox `play`). Pass
// `--no-play` to skip playback (useful when only the PCM file output is
// needed, e.g. for offline diff comparison). `--output` writes the
// concatenated PCM Buffer to the given path so a downstream tool can
// inspect / compare bytes across providers.

import { writeFile } from 'node:fs/promises';
import {
  createAudioPlayer,
  DEFAULT_PCM_SAMPLE_RATE,
  DEFAULT_PCM_CHANNELS,
  DEFAULT_PCM_BITS_PER_SAMPLE,
} from '../src/voice/playback/audio-player.js';
import {
  createTTSProvider,
  type TTSProvider,
  type TTSProviderConfig,
  type TTSProviderId,
} from '../src/voice/tts/tts-provider.js';

interface ParsedArgs {
  text: string;
  provider: TTSProviderId;
  voice?: string;
  hd: boolean;
  play: boolean;
  output?: string;
  speed?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let provider: TTSProviderId = 'openai-tts';
  let voice: string | undefined;
  let hd = false;
  let play = true;
  let output: string | undefined;
  let speed: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--provider') {
      const v = argv[++i];
      if (v !== 'openai-tts' && v !== 'elevenlabs-tts' && v !== 'edge-tts' && v !== 'macos-say') {
        throw new Error(`unknown --provider value: ${v ?? '(missing)'}`);
      }
      provider = v;
    } else if (arg === '--voice') {
      voice = argv[++i];
    } else if (arg === '--hd') {
      hd = true;
    } else if (arg === '--play') {
      play = true;
    } else if (arg === '--no-play') {
      play = false;
    } else if (arg === '--output' || arg === '-o') {
      output = argv[++i];
    } else if (arg === '--speed') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--speed must be a positive number, got: ${v ?? '(missing)'}`);
      }
      speed = n;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    throw new Error('text argument required (e.g. `bun scripts/tts-test.ts "안녕하세요"`)');
  }

  const result: ParsedArgs = {
    text: positional.join(' '),
    provider,
    hd,
    play,
  };
  if (voice !== undefined) result.voice = voice;
  if (output !== undefined) result.output = output;
  if (speed !== undefined) result.speed = speed;
  return result;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/tts-test.ts "<text>" [flags]

Flags:
  --provider {openai-tts|elevenlabs-tts|edge-tts|macos-say}  default: openai-tts
  --voice <id>          provider-specific voice override
  --hd                  openai-tts only — use tts-1-hd
  --play / --no-play    stream PCM to default audio device · default: --play
  --output <path>       also write concatenated PCM to file (raw 24kHz s16le mono)
  --speed <multiplier>  0.5..2.0 — provider-specific clamping
  -h / --help           print this help`);
}

function buildConfig(args: ParsedArgs): TTSProviderConfig {
  switch (args.provider) {
    case 'openai-tts':
      return {
        id: 'openai-tts',
        ...(args.hd ? { model: 'tts-1-hd' } : {}),
        ...(args.voice ? { voice: args.voice } : {}),
      };
    case 'elevenlabs-tts':
      return {
        id: 'elevenlabs-tts',
        ...(args.voice ? { voiceId: args.voice } : {}),
      };
    case 'edge-tts':
      return {
        id: 'edge-tts',
        ...(args.voice ? { voice: args.voice } : {}),
      };
    case 'macos-say':
      return {
        id: 'macos-say',
        ...(args.voice ? { voice: args.voice } : {}),
      };
  }
}

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[tts-test] ${err instanceof Error ? err.message : String(err)}`);
    printHelp();
    return 2;
  }

  console.log(`[tts-test] provider=${args.provider} voice=${args.voice ?? '(default)'} chars=${args.text.length} play=${args.play}${args.output ? ` output=${args.output}` : ''}`);

  let provider: TTSProvider;
  try {
    provider = await createTTSProvider(buildConfig(args));
  } catch (err) {
    console.error(`[tts-test] provider init failed: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  const t0 = Date.now();
  const synthOpts = {
    ...(args.voice ? { voice: args.voice } : {}),
    ...(args.speed !== undefined ? { speed: args.speed } : {}),
  };
  const player = args.play ? createAudioPlayer() : null;
  const collected: Buffer[] = [];

  try {
    if (player) {
      const started = await player.start({
        sampleRate: provider.format.sampleRate,
        channels: provider.format.channels,
        bitsPerSample: provider.format.bitsPerSample,
      });
      if (!started) {
        console.error('[tts-test] audio player failed to start — falling back to no-play');
      }
    }

    if (provider.synthesizeStream) {
      let firstChunkAt: number | null = null;
      let totalBytes = 0;
      for await (const chunk of provider.synthesizeStream(args.text, synthOpts)) {
        if (firstChunkAt === null) {
          firstChunkAt = Date.now() - t0;
          console.log(`[tts-test] first PCM chunk @ ${firstChunkAt}ms (${chunk.pcm.byteLength} bytes)`);
        }
        totalBytes += chunk.pcm.byteLength;
        if (args.output) collected.push(chunk.pcm);
        if (player?.isPlaying()) player.push(chunk.pcm);
      }
      console.log(`[tts-test] streamed ${totalBytes} bytes total`);
    } else {
      const result = await provider.synthesizeBatch(args.text, synthOpts);
      const synthMs = Date.now() - t0;
      console.log(`[tts-test] batch synth done @ ${synthMs}ms · ${result.pcm.byteLength} bytes`);
      if (args.output) collected.push(result.pcm);
      if (player?.isPlaying()) player.push(result.pcm);
    }

    if (player?.isPlaying()) {
      console.log('[tts-test] draining player (waiting for sox to finish rendering)...');
      await player.drain();
    }

    if (args.output && collected.length > 0) {
      const all = Buffer.concat(collected);
      await writeFile(args.output, all);
      console.log(`[tts-test] wrote ${all.byteLength} bytes to ${args.output} (raw ${DEFAULT_PCM_SAMPLE_RATE}Hz s${DEFAULT_PCM_BITS_PER_SAMPLE}le mono · ${DEFAULT_PCM_CHANNELS}ch)`);
    }

    const totalMs = Date.now() - t0;
    console.log(`[tts-test] done in ${totalMs}ms`);
    return 0;
  } catch (err) {
    console.error(`[tts-test] synth failed: ${err instanceof Error ? err.message : String(err)}`);
    if (player?.isPlaying()) {
      try { await player.stop(); } catch { /* ignore */ }
    }
    return 4;
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[tts-test] uncaught:', err);
  process.exit(1);
});
