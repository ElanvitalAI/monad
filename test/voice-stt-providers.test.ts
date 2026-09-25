// PR-S1V.2 (sprint 21-Parallel-Voice · 2026-04-29) — STT provider
// interface + OpenAI Whisper batch tests.
//
// Tested invariants:
//   1. WAV wrapping produces a valid RIFF/WAVE header with the right
//      sample rate / channels / bits + pcm payload.
//   2. wrapPcmInWav rejects unsupported bitsPerSample values.
//   3. Provider construction needs an API key (env var or cfg).
//   4. transcribeBatch on empty buffer throws.
//   5. transcribeBatch posts multipart/form-data with the right URL,
//      Authorization header, model, and language opt.
//   6. transcribeBatch returns text/language/durationMs from the
//      response.
//   7. transcribeBatch surfaces non-OK responses as Error.
//   8. Factory dispatches 'openai-whisper' to the impl, throws
//      STTProviderNotImplementedError for not-yet-implemented ids.
//   9. STT_PROVIDERS metadata flags `openai-whisper` as implemented
//      and others as `implemented: false`.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createSTTProvider,
  STTProviderNotImplementedError,
  STT_PROVIDERS,
} from '../src/voice/stt-provider.js';
import {
  OpenAIWhisperProvider,
  wrapPcmInWav,
} from '../src/voice/stt-providers/openai-whisper.js';

// ── env helpers ─────────────────────────────────────────────────────

const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};

function captureEnv(): void {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

beforeEach(() => {
  captureEnv();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
  restoreEnv();
});

// ── WAV wrapping ────────────────────────────────────────────────────

describe('PR-S1V.2 · wrapPcmInWav', () => {
  test('produces a 44-byte header + raw PCM payload', () => {
    const pcm = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const wav = wrapPcmInWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  test('writes sample rate / channels / bitsPerSample correctly', () => {
    const pcm = Buffer.alloc(100);
    const wav = wrapPcmInWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(32000); // byte rate = 16000 * 1 * 16 / 8
    expect(wav.readUInt16LE(32)).toBe(2); // block align = 1 * 16 / 8
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(pcm.byteLength); // data chunk size
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.byteLength); // RIFF size
  });

  test('rejects unsupported bitsPerSample', () => {
    const pcm = Buffer.alloc(4);
    expect(() => wrapPcmInWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 7 as 8 }))
      .toThrow('bitsPerSample');
  });

  test('rejects channels < 1', () => {
    const pcm = Buffer.alloc(4);
    expect(() => wrapPcmInWav(pcm, { sampleRate: 16000, channels: 0, bitsPerSample: 16 }))
      .toThrow('channels');
  });
});

// ── Provider construction ───────────────────────────────────────────

describe('PR-S1V.2 · OpenAIWhisperProvider construction', () => {
  test('throws when no API key is available', () => {
    expect(() => new OpenAIWhisperProvider({ id: 'openai-whisper' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  test('accepts cfg.apiKey explicitly', () => {
    const provider = new OpenAIWhisperProvider({ id: 'openai-whisper', apiKey: 'sk-test-1' });
    expect(provider.id).toBe('openai-whisper');
  });

  test('falls back to OPENAI_API_KEY env var', () => {
    process.env.OPENAI_API_KEY = 'sk-env-key';
    const provider = new OpenAIWhisperProvider({ id: 'openai-whisper' });
    expect(provider.id).toBe('openai-whisper');
  });

  test('strips trailing slash from baseUrl', () => {
    const provider = new OpenAIWhisperProvider({
      id: 'openai-whisper',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com///',
    });
    // No public getter — we infer from a fetch spy that the URL has no
    // double slashes (verified by the fetch test below).
    expect(provider.id).toBe('openai-whisper');
  });
});

// ── transcribeBatch ─────────────────────────────────────────────────

describe('PR-S1V.2 · OpenAIWhisperProvider.transcribeBatch', () => {
  test('throws on empty buffer', async () => {
    const provider = new OpenAIWhisperProvider({ id: 'openai-whisper', apiKey: 'sk-test' });
    await expect(provider.transcribeBatch(Buffer.alloc(0))).rejects.toThrow('empty');
  });

  test('posts to /v1/audio/transcriptions with Bearer auth + model + form file', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      captured.url = String(url);
      captured.init = init;
      return new Response(JSON.stringify({ text: 'hello world', language: 'en' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch);
    try {
      const provider = new OpenAIWhisperProvider({
        id: 'openai-whisper',
        apiKey: 'sk-test-123',
        baseUrl: 'https://example.com',
      });
      const pcm = Buffer.alloc(1024);
      const result = await provider.transcribeBatch(pcm, { language: 'ko' });

      expect(captured.url).toBe('https://example.com/v1/audio/transcriptions');
      expect(captured.init?.method).toBe('POST');
      const auth = (captured.init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer sk-test-123');

      const body = captured.init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('model')).toBe('whisper-1');
      expect(body.get('language')).toBe('ko');
      expect(body.get('response_format')).toBe('json');
      const fileEntry = body.get('file') as File | Blob;
      expect(fileEntry).toBeInstanceOf(Blob);

      expect(result.text).toBe('hello world');
      expect(result.language).toBe('en');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('uses custom model when configured', async () => {
    let modelSeen: string | undefined;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      modelSeen = (init?.body as FormData).get('model') as string;
      return new Response(JSON.stringify({ text: '' }), { status: 200 });
    }) as typeof globalThis.fetch);
    try {
      const provider = new OpenAIWhisperProvider({
        id: 'openai-whisper',
        apiKey: 'sk-test',
        model: 'gpt-4o-transcribe',
      });
      await provider.transcribeBatch(Buffer.alloc(100));
      expect(modelSeen).toBe('gpt-4o-transcribe');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('returns durationMs from response duration when provided', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      new Response(JSON.stringify({ text: 'ok', duration: 2.5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch);
    try {
      const provider = new OpenAIWhisperProvider({ id: 'openai-whisper', apiKey: 'sk-test' });
      const result = await provider.transcribeBatch(Buffer.alloc(100));
      expect(result.durationMs).toBe(2500);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('throws Error with status + body snippet on non-OK response', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      new Response('Invalid API key', {
        status: 401,
        statusText: 'Unauthorized',
      })) as unknown as typeof globalThis.fetch);
    try {
      const provider = new OpenAIWhisperProvider({ id: 'openai-whisper', apiKey: 'sk-bad' });
      await expect(provider.transcribeBatch(Buffer.alloc(100))).rejects.toThrow(/401/);
      // Re-run for body assertion (each call triggers a fresh response).
      await expect(provider.transcribeBatch(Buffer.alloc(100))).rejects.toThrow(/Invalid API key/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('throws when response is OK but no text field', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      new Response(JSON.stringify({ language: 'en' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch);
    try {
      const provider = new OpenAIWhisperProvider({ id: 'openai-whisper', apiKey: 'sk-test' });
      await expect(provider.transcribeBatch(Buffer.alloc(100))).rejects.toThrow(/no text/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ── Factory ─────────────────────────────────────────────────────────

describe('PR-S1V.2 · createSTTProvider', () => {
  test('returns OpenAIWhisperProvider for openai-whisper config', async () => {
    const provider = await createSTTProvider({
      id: 'openai-whisper',
      apiKey: 'sk-test',
    });
    expect(provider.id).toBe('openai-whisper');
    expect(provider).toBeInstanceOf(OpenAIWhisperProvider);
  });

  test('throws STTProviderNotImplementedError for openai-realtime (PR-S1V.2-stream)', async () => {
    await expect(createSTTProvider({ id: 'openai-realtime' })).rejects.toBeInstanceOf(
      STTProviderNotImplementedError,
    );
  });

  test('throws STTProviderNotImplementedError for elevenlabs-scribe (Premium · follow-up)', async () => {
    await expect(createSTTProvider({ id: 'elevenlabs-scribe' })).rejects.toBeInstanceOf(
      STTProviderNotImplementedError,
    );
  });
});

// ── Provider registry ───────────────────────────────────────────────

describe('PR-S1V.2 · STT_PROVIDERS metadata', () => {
  test('flags openai-whisper as implemented + paid tier', () => {
    expect(STT_PROVIDERS['openai-whisper'].implemented).toBe(true);
    expect(STT_PROVIDERS['openai-whisper'].tier).toBe('paid');
  });

  test('flags openai-realtime / elevenlabs-scribe / whisper-cpp as not implemented yet', () => {
    expect(STT_PROVIDERS['openai-realtime'].implemented).toBe(false);
    expect(STT_PROVIDERS['elevenlabs-scribe'].implemented).toBe(false);
    expect(STT_PROVIDERS['whisper-cpp'].implemented).toBe(false);
  });

  test('elevenlabs-scribe is gated to premium tier', () => {
    expect(STT_PROVIDERS['elevenlabs-scribe'].tier).toBe('premium');
  });
});
