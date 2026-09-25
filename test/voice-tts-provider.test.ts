// PR-S1V.6 (sprint 22 Phase 1) — TTS provider factory + registry +
// env switch.
//
// Real wiring per CLAUDE.md: createTTSProvider lazy-imports the actual
// provider classes; we just feed configs and assert shapes.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createTTSProvider,
  DEFAULT_TTS_PCM_FORMAT,
  resolveTTSProviderIdFromEnv,
  TTS_PROVIDERS,
  TTSProviderNotImplementedError,
  TTSProviderUnavailableError,
} from '../src/voice/tts/tts-provider.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe('TTS_PROVIDERS registry', () => {
  it('contains all four providers', () => {
    expect(Object.keys(TTS_PROVIDERS).sort()).toEqual([
      'edge-tts',
      'elevenlabs-tts',
      'macos-say',
      'openai-tts',
    ]);
  });

  it('marks every provider as implemented in Phase 1', () => {
    for (const info of Object.values(TTS_PROVIDERS)) {
      expect(info.implemented).toBe(true);
    }
  });

  it('tier classification matches tier gating intent', () => {
    expect(TTS_PROVIDERS['openai-tts'].tier).toBe('paid');
    expect(TTS_PROVIDERS['elevenlabs-tts'].tier).toBe('premium');
    expect(TTS_PROVIDERS['edge-tts'].tier).toBe('free');
    expect(TTS_PROVIDERS['macos-say'].tier).toBe('free');
  });

  it('streaming flag matches network-streaming providers', () => {
    expect(TTS_PROVIDERS['openai-tts'].streaming).toBe(true);
    expect(TTS_PROVIDERS['elevenlabs-tts'].streaming).toBe(true);
    expect(TTS_PROVIDERS['edge-tts'].streaming).toBe(false);
    expect(TTS_PROVIDERS['macos-say'].streaming).toBe(false);
  });
});

describe('DEFAULT_TTS_PCM_FORMAT', () => {
  it('declares 24kHz · mono · 16-bit (matches audio-player default)', () => {
    expect(DEFAULT_TTS_PCM_FORMAT.sampleRate).toBe(24000);
    expect(DEFAULT_TTS_PCM_FORMAT.channels).toBe(1);
    expect(DEFAULT_TTS_PCM_FORMAT.bitsPerSample).toBe(16);
  });
});

describe('resolveTTSProviderIdFromEnv', () => {
  it('returns the fallback when TTS_PROVIDER is unset', () => {
    delete process.env.TTS_PROVIDER;
    expect(resolveTTSProviderIdFromEnv()).toBe('openai-tts');
    expect(resolveTTSProviderIdFromEnv('edge-tts')).toBe('edge-tts');
  });

  it('returns the env value when valid', () => {
    process.env.TTS_PROVIDER = 'edge-tts';
    expect(resolveTTSProviderIdFromEnv()).toBe('edge-tts');
    process.env.TTS_PROVIDER = 'elevenlabs-tts';
    expect(resolveTTSProviderIdFromEnv()).toBe('elevenlabs-tts');
    process.env.TTS_PROVIDER = 'macos-say';
    expect(resolveTTSProviderIdFromEnv()).toBe('macos-say');
  });

  it('falls back when env value is unknown', () => {
    process.env.TTS_PROVIDER = 'bogus-provider';
    expect(resolveTTSProviderIdFromEnv()).toBe('openai-tts');
    expect(resolveTTSProviderIdFromEnv('edge-tts')).toBe('edge-tts');
  });

  it('is case-insensitive and trims whitespace', () => {
    process.env.TTS_PROVIDER = '  EDGE-TTS  ';
    expect(resolveTTSProviderIdFromEnv()).toBe('edge-tts');
  });
});

describe('createTTSProvider factory', () => {
  it('throws when openai-tts has no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(createTTSProvider({ id: 'openai-tts' })).rejects.toThrow(/OpenAI API key/);
  });

  it('throws when elevenlabs-tts has no API key', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(createTTSProvider({ id: 'elevenlabs-tts' })).rejects.toThrow(/ElevenLabs API key/);
  });

  it('builds openai-tts provider when API key is present', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-aaa';
    const p = await createTTSProvider({ id: 'openai-tts' });
    expect(p.id).toBe('openai-tts');
    expect(p.format).toEqual(DEFAULT_TTS_PCM_FORMAT);
    expect(typeof p.synthesizeBatch).toBe('function');
    expect(typeof p.synthesizeStream).toBe('function');
  });

  it('builds elevenlabs-tts provider when API key is present', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-test-bbb';
    const p = await createTTSProvider({ id: 'elevenlabs-tts' });
    expect(p.id).toBe('elevenlabs-tts');
    expect(p.format).toEqual(DEFAULT_TTS_PCM_FORMAT);
    expect(typeof p.synthesizeStream).toBe('function');
  });

  it('builds edge-tts provider without any keys', async () => {
    const p = await createTTSProvider({ id: 'edge-tts' });
    expect(p.id).toBe('edge-tts');
    expect(p.format).toEqual(DEFAULT_TTS_PCM_FORMAT);
    expect(p.synthesizeStream).toBeUndefined();
  });

  it('builds macos-say provider on darwin without keys', async () => {
    if (process.platform !== 'darwin') {
      // On non-darwin, we expect it to throw — covered by separate test.
      return;
    }
    const p = await createTTSProvider({ id: 'macos-say' });
    expect(p.id).toBe('macos-say');
    expect(p.format).toEqual(DEFAULT_TTS_PCM_FORMAT);
  });

  it('throws TTSProviderUnavailableError for macos-say on non-darwin', async () => {
    if (process.platform === 'darwin') {
      // Cannot exercise this branch on the host platform.
      return;
    }
    await expect(createTTSProvider({ id: 'macos-say' })).rejects.toThrow(TTSProviderUnavailableError);
  });
});

describe('TTSProviderNotImplementedError', () => {
  it('is thrown when an unknown id leaks through the union', async () => {
    // Bypass the union narrowing for this branch. Should never happen
    // in normal code but the factory catches it so a downstream caller
    // gets a clear error rather than a generic TypeError.
    const cfg = { id: 'unknown-provider' } as unknown as Parameters<typeof createTTSProvider>[0];
    await expect(createTTSProvider(cfg)).rejects.toThrow(TTSProviderNotImplementedError);
  });
});
