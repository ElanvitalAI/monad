// PR-S1V.5 (sprint 21-Parallel-Voice · 2026-04-29) — PWA voice REST
// dogfood simulation.
//
// SSH-friendly verification of the daemon side of the PWA voice path
// without a browser, mic, or OpenAI API key. Drives the actual
// `voice-rest-handler` against a fake STTProvider that returns canned
// transcripts, then asserts the full chain — multipart parsing →
// transcribe → cost record → response shape — behaves the way the
// PWA `voice-recorder.ts` will rely on. Mirrors the pattern from
// `scripts/voice-dogfood-sim.ts` (PR #1084).
//
// What this verifies:
//   1. Multipart audio + sessionId + lang parsing.
//   2. STTProvider proxy returns transcript + cost USD.
//   3. Provider durationMs is preferred when present.
//   4. PCM byte-length fallback when provider omits durationMs.
//   5. Cost-tracker records every successful call (per-session attribution).
//   6. handleCost reflects the running monthly total.
//   7. Error mapping — empty audio → 400 · provider throw → 502 ·
//      no provider → 503 · wrong content-type → 415.
//
// What this does NOT verify (real dogfood territory):
//   - Browser MediaRecorder lifecycle (PWA β-2 PR · physical mic).
//   - Real OpenAI Whisper accuracy (PR-S1V.2 dogfood already covered).
//   - HTTPS / secure context for mic permission (deployment guidance).
//
// Run: bun run scripts/voice-pwa-sim.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceRestHandler } from '../src/voice/voice-rest-handler.js';
import { createVoiceCostTracker, type VoiceCostEvent } from '../src/voice/cost-tracker.js';
import type { STTProvider, STTResult } from '../src/voice/stt-provider.js';

// ── Fake STT provider ─────────────────────────────────────────────

interface CannedTranscript {
  text: string;
  language?: string;
  durationMs?: number;
}

function fakeStt(canned: CannedTranscript): STTProvider {
  return {
    id: 'openai-whisper',
    transcribeBatch: async (_pcm, _opts): Promise<STTResult> => ({
      text: canned.text,
      ...(canned.language ? { language: canned.language } : {}),
      ...(canned.durationMs !== undefined ? { durationMs: canned.durationMs } : {}),
    }),
  };
}

function audioBlob(bytes: number, type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(bytes).fill(0xab)], { type });
}

function multipartReq(parts: { audio?: Blob; sessionId?: string; lang?: string }): Request {
  const fd = new FormData();
  if (parts.audio) fd.append('audio', parts.audio, 'voice.webm');
  if (parts.sessionId) fd.append('sessionId', parts.sessionId);
  if (parts.lang) fd.append('lang', parts.lang);
  return new Request('http://localhost/v1/voice/transcribe', { method: 'POST', body: fd });
}

const ICON = { pass: '✓', fail: '✗' };

function check(label: string, ok: boolean, detail?: string): boolean {
  const icon = ok ? ICON.pass : ICON.fail;
  console.log(`    ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// ── Scenarios ────────────────────────────────────────────────────

interface Scenario {
  label: string;
  run(): Promise<boolean>;
}

const tmpDir = mkdtempSync(join(tmpdir(), 'voice-pwa-sim-'));
const eventPath = join(tmpDir, 'voice-cost-events.jsonl');
const tracker = createVoiceCostTracker({ eventPath, disablePersist: false });
const events: VoiceCostEvent[] = [];
tracker.subscribe((e) => events.push(e));

const SCENARIOS: Scenario[] = [
  {
    label: '1. Korean transcript with provider durationMs (sessionId attribution)',
    run: async () => {
      const stt = fakeStt({ text: '코덱스에게 react 만들어줘', language: 'ko', durationMs: 3000 });
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      const before = events.length;
      const res = await handler.handleTranscribe(multipartReq({
        audio: audioBlob(8192),
        sessionId: 'sess-codex',
        lang: 'ko',
      }));
      let ok = check('status 200', res.status === 200);
      const body = await res.json() as Record<string, unknown>;
      ok = check('transcript', body.transcript === '코덱스에게 react 만들어줘',
        `got="${body.transcript}"`) && ok;
      ok = check('language', body.language === 'ko') && ok;
      ok = check('durationMs honoured', body.durationMs === 3000) && ok;
      ok = check('costUsd computed', typeof body.costUsd === 'number' && (body.costUsd as number) > 0,
        `usd=${body.costUsd}`) && ok;
      ok = check('cost event recorded', events.length === before + 1) && ok;
      const ev = events[events.length - 1];
      if (ev?.kind === 'stt') {
        ok = check('event.sessionId attribution', ev.sessionId === 'sess-codex',
          `got=${ev.sessionId}`) && ok;
      }
      return ok;
    },
  },
  {
    label: '2. PCM byte-length fallback when durationMs missing',
    run: async () => {
      const stt = fakeStt({ text: 'hello' }); // no durationMs
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      // 32 000 bytes = 1 000 ms at PCM rate (16 kHz · 16-bit · mono)
      const before = events.length;
      const res = await handler.handleTranscribe(multipartReq({ audio: audioBlob(32_000) }));
      let ok = check('status 200', res.status === 200);
      const ev = events[events.length - 1];
      if (ev?.kind === 'stt') {
        ok = check('fallback durationMs ≈ 1000 (32 bytes/ms)',
          Math.abs(ev.durationMs - 1000) < 5,
          `got=${ev.durationMs}`) && ok;
        ok = check('cost event added', events.length === before + 1) && ok;
      } else {
        ok = check('cost event is stt', false) && ok;
      }
      return ok;
    },
  },
  {
    label: '3. handleCost reflects running monthly totals',
    run: async () => {
      const handler = createVoiceRestHandler({
        getSttProvider: () => fakeStt({ text: '' }),
        costTracker: tracker,
      });
      const res = handler.handleCost();
      const body = await res.json() as Record<string, unknown>;
      let ok = check('status 200', res.status === 200);
      ok = check('totalUsd matches tracker',
        Math.abs((body.totalUsd as number) - tracker.getMonthSummary().totalUsd) < 1e-9) && ok;
      ok = check('sttDurationSec > 0 after prior scenarios',
        (body.sttDurationSec as number) > 0,
        `sttDurationSec=${body.sttDurationSec}`) && ok;
      ok = check('monthYYYYMM present and well-formed',
        typeof body.monthYYYYMM === 'string' && /^\d{4}-\d{2}$/.test(body.monthYYYYMM as string)) && ok;
      return ok;
    },
  },
  {
    label: '4. Empty audio → 400 empty-audio · cost not recorded',
    run: async () => {
      const stt = fakeStt({ text: 'noop' });
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      const before = events.length;
      const audio = new Blob([], { type: 'audio/webm' });
      const res = await handler.handleTranscribe(multipartReq({ audio }));
      let ok = check('status 400', res.status === 400);
      const body = await res.json() as Record<string, unknown>;
      ok = check('error code', body.error === 'empty-audio') && ok;
      ok = check('cost not incremented', events.length === before) && ok;
      return ok;
    },
  },
  {
    label: '5. Provider throw → 502 · cost not recorded',
    run: async () => {
      const stt: STTProvider = {
        id: 'openai-whisper',
        transcribeBatch: async () => { throw new Error('upstream timeout'); },
      };
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      const before = events.length;
      const res = await handler.handleTranscribe(multipartReq({ audio: audioBlob(1024) }));
      let ok = check('status 502', res.status === 502);
      const body = await res.json() as Record<string, unknown>;
      ok = check('error code', body.error === 'stt-failed') && ok;
      ok = check('cost not incremented on failure', events.length === before) && ok;
      return ok;
    },
  },
  {
    label: '6. No STT provider → 503 stt-unavailable',
    run: async () => {
      const handler = createVoiceRestHandler({ getSttProvider: () => null, costTracker: tracker });
      const res = await handler.handleTranscribe(multipartReq({ audio: audioBlob(1024) }));
      let ok = check('status 503', res.status === 503);
      const body = await res.json() as Record<string, unknown>;
      ok = check('error code', body.error === 'stt-unavailable') && ok;
      return ok;
    },
  },
  {
    label: '7. Wrong content-type → 415',
    run: async () => {
      const stt = fakeStt({ text: 'x' });
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      const req = new Request('http://localhost/v1/voice/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const res = await handler.handleTranscribe(req);
      let ok = check('status 415', res.status === 415);
      const body = await res.json() as Record<string, unknown>;
      ok = check('error code', body.error === 'invalid-content-type') && ok;
      return ok;
    },
  },
  {
    label: '8. Multiple sessionIds → cost attributed per session',
    run: async () => {
      const stt = fakeStt({ text: 'plan', durationMs: 2000 });
      const handler = createVoiceRestHandler({ getSttProvider: () => stt, costTracker: tracker });
      const before = events.length;
      await handler.handleTranscribe(multipartReq({ audio: audioBlob(1024), sessionId: 'sess-A' }));
      await handler.handleTranscribe(multipartReq({ audio: audioBlob(1024), sessionId: 'sess-B' }));
      const newEvents = events.slice(before);
      let ok = check('two events recorded', newEvents.length === 2);
      ok = check('event A sessionId',
        newEvents[0]?.kind === 'stt' && newEvents[0].sessionId === 'sess-A') && ok;
      ok = check('event B sessionId',
        newEvents[1]?.kind === 'stt' && newEvents[1].sessionId === 'sess-B') && ok;
      return ok;
    },
  },
];

async function main(): Promise<number> {
  console.log('━━━ PR-S1V.5 · headless PWA voice REST simulation ━━━');
  console.log(`  cost-tracker JSONL: ${eventPath}`);
  console.log('');
  let passed = 0;
  let failed = 0;
  for (const s of SCENARIOS) {
    console.log(`[${s.label}]`);
    const ok = await s.run();
    ok ? passed++ : failed++;
  }
  const summary = tracker.getMonthSummary();
  console.log('\n━━━ Cost tracker month summary ━━━');
  console.log(`  monthYYYYMM:    ${summary.monthYYYYMM}`);
  console.log(`  sttUsd:         $${summary.sttUsd.toFixed(6)}`);
  console.log(`  sttDurationSec: ${summary.sttDurationSec.toFixed(2)}`);
  console.log(`  totalUsd:       $${summary.totalUsd.toFixed(6)}`);

  console.log('\n━━━ Summary ━━━');
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  console.log(`  total:  ${passed + failed}`);
  rmSync(tmpDir, { recursive: true, force: true });
  return failed === 0 ? 0 : 1;
}

main().then((rc) => process.exit(rc)).catch((err) => {
  console.error('sim crashed:', err);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(2);
});
