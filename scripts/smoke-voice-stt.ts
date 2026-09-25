// Smoke test for PR-S1V.2 OpenAI Whisper STT batch — full voice → text
// Run: bun run scripts/smoke-voice-stt.ts
//
// 1. Probes audio backend (PR-S1V.1).
// 2. Records ~3s of audio (push-to-talk · no silence detect).
// 3. Posts the PCM (wrapped as WAV) to OpenAI Whisper.
// 4. Prints transcript + language + latency + cost estimate.
//
// Requires `OPENAI_API_KEY` env var and `sox` installed (PR-S1V.1).

import {
  checkRecordingAvailability,
  startRecording,
  stopRecording,
} from '../src/voice/audio-capture.js';
import { createSTTProvider } from '../src/voice/stt-provider.js';

const RECORD_MS = 3000;
const PCM_SAMPLE_RATE = 16000;
const PCM_BYTES_PER_SAMPLE = 2;
const WHISPER_USD_PER_MIN = 0.006;

async function main(): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('✗ OPENAI_API_KEY not set in environment.');
    return 2;
  }

  const avail = await checkRecordingAvailability();
  console.log('[1] checkRecordingAvailability:', avail);
  if (!avail.available) return 2;

  console.log(`[2] 🎙  녹음 시작 — ${RECORD_MS / 1000}초 동안 마이크에 말씀해주세요...`);
  const chunks: Buffer[] = [];
  let bytes = 0;
  const started = await startRecording(
    chunk => {
      chunks.push(chunk);
      bytes += chunk.length;
    },
    () => {},
    { silenceDetection: false },
  );
  if (!started) {
    console.error('   ✗ recording failed to start');
    return 3;
  }
  await new Promise(r => setTimeout(r, RECORD_MS));
  stopRecording();
  await new Promise(r => setTimeout(r, 250));
  const audioSec = bytes / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE);
  console.log(`[3] captured: ${bytes} bytes in ${chunks.length} chunks (~${audioSec.toFixed(1)}s)`);

  if (bytes === 0) {
    console.error('   ✗ 0 bytes captured — mic permission 또는 sox 문제 가능');
    return 1;
  }

  const pcm = Buffer.concat(chunks);

  console.log('[4] 📡 OpenAI Whisper 호출 중...');
  const provider = await createSTTProvider({ id: 'openai-whisper' });
  const t0 = Date.now();
  const result = await provider.transcribeBatch(pcm, { language: 'ko' });
  const apiMs = Date.now() - t0;

  const cost = (audioSec / 60) * WHISPER_USD_PER_MIN;

  console.log('\n========== TRANSCRIPT ==========');
  console.log(result.text.trim() || '(empty — 발화 못 들었거나 silence)');
  console.log('================================\n');
  console.log(`Language detected: ${result.language ?? '(n/a)'}`);
  console.log(`Audio duration:    ${result.durationMs ?? '(n/a)'} ms`);
  console.log(`API roundtrip:     ${apiMs} ms`);
  console.log(`Estimated cost:    $${cost.toFixed(4)} (Whisper @ $${WHISPER_USD_PER_MIN}/min)`);
  return result.text.trim().length > 0 ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('FAIL:', err);
    process.exit(1);
  });
