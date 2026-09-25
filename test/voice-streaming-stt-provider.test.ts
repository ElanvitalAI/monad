// PR-S1V.8 (sprint 22 Phase 3) — streaming STT factory + registry +
// env switch.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createStreamingSTTProvider,
  DEFAULT_STREAMING_STT_FORMAT,
  resolveStreamingSTTProviderIdFromEnv,
  STREAMING_STT_PROVIDERS,
  StreamingSTTProviderUnavailableError,
} from '../src/voice/streaming-stt/streaming-stt-provider.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe('STREAMING_STT_PROVIDERS registry', () => {
  it('contains all registered providers', () => {
    expect(Object.keys(STREAMING_STT_PROVIDERS).sort()).toEqual([
      'elevenlabs-scribe-realtime',
      'gemini-live-stt',
      'openai-realtime-stt',
      'whisper-cpp-local',
    ]);
  });

  it('marks every provider as implemented', () => {
    for (const info of Object.values(STREAMING_STT_PROVIDERS)) {
      expect(info.implemented).toBe(true);
    }
  });

  it('serverVad flag matches each provider behavior', () => {
    expect(STREAMING_STT_PROVIDERS['openai-realtime-stt'].serverVad).toBe(true);
    expect(STREAMING_STT_PROVIDERS['gemini-live-stt'].serverVad).toBe(true);
    expect(STREAMING_STT_PROVIDERS['whisper-cpp-local'].serverVad).toBe(false);
  });

  it('tier classification', () => {
    expect(STREAMING_STT_PROVIDERS['openai-realtime-stt'].tier).toBe('paid');
    expect(STREAMING_STT_PROVIDERS['gemini-live-stt'].tier).toBe('paid');
    expect(STREAMING_STT_PROVIDERS['whisper-cpp-local'].tier).toBe('free');
  });
});

describe('DEFAULT_STREAMING_STT_FORMAT', () => {
  it('declares 16kHz · mono · 16-bit', () => {
    expect(DEFAULT_STREAMING_STT_FORMAT.sampleRate).toBe(24000);
    expect(DEFAULT_STREAMING_STT_FORMAT.channels).toBe(1);
    expect(DEFAULT_STREAMING_STT_FORMAT.bitsPerSample).toBe(16);
  });
});

describe('resolveStreamingSTTProviderIdFromEnv', () => {
  it('returns fallback when STREAMING_STT_PROVIDER unset', () => {
    delete process.env.STREAMING_STT_PROVIDER;
    expect(resolveStreamingSTTProviderIdFromEnv()).toBe('openai-realtime-stt');
    expect(resolveStreamingSTTProviderIdFromEnv('gemini-live-stt')).toBe('gemini-live-stt');
  });

  it('returns env value when valid', () => {
    process.env.STREAMING_STT_PROVIDER = 'gemini-live-stt';
    expect(resolveStreamingSTTProviderIdFromEnv()).toBe('gemini-live-stt');
    process.env.STREAMING_STT_PROVIDER = 'whisper-cpp-local';
    expect(resolveStreamingSTTProviderIdFromEnv()).toBe('whisper-cpp-local');
  });

  it('falls back when env value unknown', () => {
    process.env.STREAMING_STT_PROVIDER = 'made-up-id';
    expect(resolveStreamingSTTProviderIdFromEnv()).toBe('openai-realtime-stt');
  });
});

describe('createStreamingSTTProvider factory', () => {
  it('throws Unavailable when openai-realtime-stt has no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      createStreamingSTTProvider({ id: 'openai-realtime-stt' }),
    ).rejects.toThrow(StreamingSTTProviderUnavailableError);
  });

  it('throws Unavailable when gemini-live-stt has no API key', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await expect(
      createStreamingSTTProvider({ id: 'gemini-live-stt' }),
    ).rejects.toThrow(StreamingSTTProviderUnavailableError);
  });

  it('throws Unavailable when whisper-cpp-local has no model path', async () => {
    delete process.env.WHISPER_CPP_MODEL;
    await expect(
      createStreamingSTTProvider({ id: 'whisper-cpp-local' }),
    ).rejects.toThrow(StreamingSTTProviderUnavailableError);
  });

  it('builds openai-realtime-stt with API key + format=16k mono', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-aaa';
    const p = await createStreamingSTTProvider({ id: 'openai-realtime-stt' });
    expect(p.id).toBe('openai-realtime-stt');
    expect(p.format.sampleRate).toBe(24000);
  });

  it('builds gemini-live-stt with API key + format', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    const p = await createStreamingSTTProvider({ id: 'gemini-live-stt' });
    expect(p.id).toBe('gemini-live-stt');
    // 2026-07-12 선언 포맷 정정 — pushAudio 와이어 라벨(rate=16000)과 일치.
    expect(p.format.sampleRate).toBe(16000);
  });

  it('builds whisper-cpp-local with model path', async () => {
    process.env.WHISPER_CPP_MODEL = '/tmp/fake-model.gguf';
    const p = await createStreamingSTTProvider({ id: 'whisper-cpp-local' });
    expect(p.id).toBe('whisper-cpp-local');
    expect(p.format.sampleRate).toBe(24000);
  });
});
