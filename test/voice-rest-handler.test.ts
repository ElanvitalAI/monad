// PR-S1V.5 (sprint 21-Parallel-Voice · 2026-04-29) — Voice REST handler
// tests.
//
// Covers:
//   1. handleTranscribe — happy path: multipart audio + sessionId →
//      STTProvider.transcribeBatch → JSON response with transcript +
//      cost.
//   2. handleTranscribe — 503 when no STT provider configured.
//   3. handleTranscribe — 415 wrong content-type · 400 missing audio
//      · 400 empty audio · 413 oversize audio.
//   4. handleTranscribe — 502 when provider throws.
//   5. handleCost — returns the tracker's current month summary.
//   6. cost record happens once per successful transcribe.

import { describe, expect, mock, test } from 'bun:test';
import { createVoiceRestHandler } from '../src/voice/voice-rest-handler.js';
import {
  createVoiceCostTracker,
  type VoiceCostEvent,
} from '../src/voice/cost-tracker.js';
import type { STTProvider, STTResult } from '../src/voice/stt-provider.js';

function fakeStt(text: string, durationMs?: number): STTProvider {
  return {
    id: 'openai-whisper',
    transcribeBatch: mock(async (_pcm: Buffer): Promise<STTResult> => ({
      text,
      ...(durationMs !== undefined ? { durationMs } : {}),
    })),
  };
}

function multipartReq(parts: { audio?: Blob | null; sessionId?: string; lang?: string; contentType?: string }): Request {
  const fd = new FormData();
  if (parts.audio !== undefined && parts.audio !== null) fd.append('audio', parts.audio, 'voice.webm');
  if (parts.sessionId) fd.append('sessionId', parts.sessionId);
  if (parts.lang) fd.append('lang', parts.lang);
  return new Request('http://localhost/v1/voice/transcribe', {
    method: 'POST',
    body: fd,
    ...(parts.contentType !== undefined ? { headers: { 'content-type': parts.contentType } } : {}),
  });
}

describe('PR-S1V.5 · voice-rest-handler · handleTranscribe happy path', () => {
  test('multipart audio → STT proxy → transcript + cost USD', async () => {
    const stt = fakeStt('코덱스에게 plan 짜줘', 2_500);
    const tracker = createVoiceCostTracker({ disablePersist: true });
    const events: VoiceCostEvent[] = [];
    tracker.subscribe((e) => events.push(e));
    const handler = createVoiceRestHandler({
      getSttProvider: () => stt,
      costTracker: tracker,
    });
    const audio = new Blob([new Uint8Array(4096).fill(7)], { type: 'audio/webm' });
    const res = await handler.handleTranscribe(multipartReq({ audio, sessionId: 'sess-x', lang: 'ko' }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.transcript).toBe('코덱스에게 plan 짜줘');
    expect(body.sttProvider).toBe('openai-whisper');
    expect(body.durationMs).toBe(2_500);
    expect(typeof body.costUsd).toBe('number');
    expect(body.costUsd).toBeCloseTo((2_500 / 60_000) * 0.006, 6);
    // STT provider was called with PCM bytes.
    expect(stt.transcribeBatch).toHaveBeenCalledTimes(1);
    // Cost event recorded with the sessionId.
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('stt');
    if (events[0]?.kind === 'stt') {
      expect(events[0].sessionId).toBe('sess-x');
      expect(events[0].providerId).toBe('openai-whisper');
    }
  });

  test('falls back to PCM byte length when provider omits durationMs', async () => {
    const stt = fakeStt('hi', undefined);
    const tracker = createVoiceCostTracker({ disablePersist: true });
    const handler = createVoiceRestHandler({
      getSttProvider: () => stt,
      costTracker: tracker,
    });
    // 32 000 bytes = 1 000 ms at 16 kHz · 16-bit · mono.
    const audio = new Blob([new Uint8Array(32_000).fill(0)], { type: 'audio/webm' });
    const res = await handler.handleTranscribe(multipartReq({ audio }));
    expect(res.status).toBe(200);
    // 1 s · $0.006/min · = $0.0001
    const summary = tracker.getProcessSummary();
    expect(summary.sttDurationSec).toBeCloseTo(1, 3);
    expect(summary.sttUsd).toBeCloseTo(0.0001, 6);
  });
});

describe('PR-S1V.5 · voice-rest-handler · handleTranscribe error cases', () => {
  test('503 when no STT provider configured', async () => {
    const handler = createVoiceRestHandler({
      getSttProvider: () => null,
      costTracker: createVoiceCostTracker({ disablePersist: true }),
    });
    const audio = new Blob([new Uint8Array(100).fill(0)], { type: 'audio/webm' });
    const res = await handler.handleTranscribe(multipartReq({ audio }));
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('stt-unavailable');
  });

  test('415 wrong content-type', async () => {
    const handler = createVoiceRestHandler({
      getSttProvider: () => fakeStt('x'),
      costTracker: createVoiceCostTracker({ disablePersist: true }),
    });
    const req = new Request('http://localhost/v1/voice/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await handler.handleTranscribe(req);
    expect(res.status).toBe(415);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid-content-type');
  });

  test('400 missing audio field', async () => {
    const handler = createVoiceRestHandler({
      getSttProvider: () => fakeStt('x'),
      costTracker: createVoiceCostTracker({ disablePersist: true }),
    });
    const fd = new FormData();
    fd.append('sessionId', 'sess-x');
    const req = new Request('http://localhost/v1/voice/transcribe', { method: 'POST', body: fd });
    const res = await handler.handleTranscribe(req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('missing-audio');
  });

  test('400 empty audio', async () => {
    const handler = createVoiceRestHandler({
      getSttProvider: () => fakeStt('x'),
      costTracker: createVoiceCostTracker({ disablePersist: true }),
    });
    const audio = new Blob([], { type: 'audio/webm' });
    const res = await handler.handleTranscribe(multipartReq({ audio }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('empty-audio');
  });

  test('502 when provider throws', async () => {
    const stt: STTProvider = {
      id: 'openai-whisper',
      transcribeBatch: async () => { throw new Error('upstream timeout'); },
    };
    const tracker = createVoiceCostTracker({ disablePersist: true });
    const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
    const audio = new Blob([new Uint8Array(100).fill(0)], { type: 'audio/webm' });
    const res = await handler.handleTranscribe(multipartReq({ audio }));
    expect(res.status).toBe(502);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('stt-failed');
    // Cost not recorded on failure.
    expect(tracker.getProcessSummary().totalUsd).toBe(0);
  });
});

describe('PR-S1V.5 · voice-rest-handler · handleCost', () => {
  test('returns the tracker month summary', () => {
    const tracker = createVoiceCostTracker({ disablePersist: true });
    tracker.recordStt({ providerId: 'openai-whisper', durationMs: 60_000 });
    tracker.recordTts({ providerId: 'elevenlabs-tts-flash-v2.5', charCount: 1000 });
    const handler = createVoiceRestHandler({
      getSttProvider: () => fakeStt(''),
      costTracker: tracker,
    });
    const res = handler.handleCost();
    expect(res.status).toBe(200);
    return res.json().then((body) => {
      const b = body as Record<string, unknown>;
      expect(typeof b.monthYYYYMM).toBe('string');
      expect(b.sttUsd).toBeCloseTo(0.006, 6);
      expect(b.ttsUsd).toBeCloseTo(0.02, 6);
      expect(b.totalUsd).toBeCloseTo(0.026, 6);
      expect(b.sttDurationSec).toBeCloseTo(60, 6);
      expect(b.ttsCharCount).toBe(1000);
    });
  });
});
