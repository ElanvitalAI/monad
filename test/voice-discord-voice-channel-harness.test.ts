// Tests for the Discord voice channel ↔ harness wire (Phase 6 wire ·
// 2026-04-30). Verifies the round-trip: session.onAudioReceived
// pumps PCM into a streaming-STT session, the final transcript fires
// the runHarness callback, and TTS deltas are written back to
// session.sendAudio.

import { afterEach, describe, it, expect } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createIntakeStore, maybeHandleSpokenVoiceIntake } from '../src/intake-plane/index.js';
import { setIntakeStoreForTest } from '../src/intake-plane/runtime.ts';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  clearPendingDecomposeForTest,
  resetToxRuntimeDepsForTest,
  setToxRuntimeDeps,
} from '../src/task-orchestrator/runtime-deps.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import type { TaskSurface } from '../src/task-orchestrator/types.ts';
import { wireDiscordSessionToHarness } from '../src/voice/channel-adapters/discord-voice-channel-harness.js';
import type { StreamingSTTProvider, StreamingSTTSession, StreamingSTTOpts } from '../src/voice/streaming-stt/streaming-stt-provider.js';
import type { TTSProvider, TTSStreamChunk } from '../src/voice/tts/tts-provider.js';
import type { DiscordVoiceChannelSession } from '../src/voice/channel-adapters/discord-voice-channel-adapter.js';
import { setDaemonTtsProviderForTesting } from '../src/voice/voice-tts-singleton.js';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function makeGenerator(proposal: unknown): TaskGenerator {
  return new TaskGenerator({
    callable: (async () => ({ text: JSON.stringify(proposal) })) as DecomposeCallable,
  });
}

interface FakeSession extends DiscordVoiceChannelSession {
  __emitAudio(pcm: Buffer, userId: string): void;
  __sentAudio(): Buffer[];
}

function makeFakeSession(): FakeSession {
  const audioSubs = new Set<(pcm: Buffer, userId: string) => void>();
  const sent: Buffer[] = [];
  return {
    sendAudio: (pcm) => { sent.push(Buffer.from(pcm)); },
    onAudioReceived: (cb) => { audioSubs.add(cb); return () => audioSubs.delete(cb); },
    onStateChange: () => () => {},
    getState: () => 'ready',
    leave: () => Promise.resolve(),
    __emitAudio: (pcm, userId) => {
      for (const cb of audioSubs) cb(pcm, userId);
    },
    __sentAudio: () => sent.slice(),
  };
}

interface FakeSttHarness {
  pushedChunks: Buffer[];
  triggerFinal(text: string): void;
  triggerError(err: Error): void;
}

function makeFakeSttProvider(harness: FakeSttHarness, opened: { value: StreamingSTTOpts | null }): StreamingSTTProvider {
  return {
    openSession: async (opts?: StreamingSTTOpts) => {
      opened.value = opts ?? null;
      const session: StreamingSTTSession = {
        pushAudio: (pcm: Buffer) => { harness.pushedChunks.push(Buffer.from(pcm)); },
        finalize: () => Promise.resolve(),
        abort: () => {},
        isOpen: () => true,
      };
      // Re-wire trigger functions to call into the active opts hooks.
      harness.triggerFinal = (text) => { opts?.onFinal?.(text); };
      harness.triggerError = (err) => { opts?.onError?.(err); };
      return session;
    },
  };
}

function makeFakeTtsProvider(): { provider: TTSProvider; lastSpoken: () => string[] } {
  const spoken: string[] = [];
  return {
    lastSpoken: () => spoken.slice(),
    provider: {
      synthesizeStream: async function* (text: string): AsyncIterable<TTSStreamChunk> {
        spoken.push(text);
        // 4 bytes of fake PCM per chunk so the pcm.length > 0 path
        // exercises session.sendAudio.
        yield { pcm: Buffer.alloc(4) };
      },
      synthesizeBatch: async (text: string) => {
        spoken.push(text);
        return { pcm: Buffer.alloc(4) };
      },
    } as unknown as TTSProvider,
  };
}

describe('wireDiscordSessionToHarness', () => {
afterEach(() => {
  clearPendingDecomposeForTest();
  resetToxRuntimeDepsForTest();
  setIntakeStoreForTest(null);
});

  it('forwards inbound PCM to the STT session', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async () => {},
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.pushedChunks.length).toBe(1);
    expect(harness.pushedChunks[0]!.length).toBe(8);
    await wire.shutdown();
  });

  it('a new final supersedes the speaking turn — stopPlayback + old sentences stop', async () => {
    // 실기기 dogfood 2026-07-12: "새 Q&A가 시작되면서 이전 발화가 안
    // 멈추고 두 개가 따로 놂". 새 final은 stopPlayback을 부르고 이전
    // 턴의 남은 문장은 epoch 가드로 전송이 끊겨야 한다.
    const session = makeFakeSession();
    let stopCalls = 0;
    (session as unknown as { stopPlayback: () => void }).stopPlayback = () => { stopCalls += 1; };
    let sttOpts: StreamingSTTOpts | undefined;
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        sttOpts = opts;
        return {
          pushAudio: () => {},
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    const spoken: string[] = [];
    // Slow TTS: each sentence takes 40 ms — turn 1's second sentence is
    // still queued when the superseding final lands.
    const tts = {
      synthesizeBatch: async (text: string) => {
        await new Promise((r) => setTimeout(r, 40));
        spoken.push(text);
        return {
          pcm: Buffer.alloc(48), // 1 ms of audio — horizon stays tiny
          format: { sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
          charCount: text.length,
        };
      },
    } as unknown as TTSProvider;
    const finals: string[] = [];
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (transcript, _ctx, cb) => {
        finals.push(transcript);
        if (transcript === '첫 질문') {
          cb.onChunk('첫 응답 문장 하나. ');
          cb.onChunk('첫 응답 문장 둘. ');
        } else {
          cb.onChunk('두번째 응답. ');
        }
        await cb.onDone('end_turn');
      },
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => tts,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    sttOpts!.onFinal?.('첫 질문');
    await new Promise((r) => setTimeout(r, 50)); // sentence 1 spoken, 2 in queue
    sttOpts!.onFinal?.('두번째 질문');           // supersede mid-speech
    await new Promise((r) => setTimeout(r, 120));
    expect(stopCalls).toBeGreaterThanOrEqual(1);
    expect(finals).toEqual(['첫 질문', '두번째 질문']);
    // Synthesis may still complete for the superseded sentence (the
    // fake TTS records at synthesis time), but the SEND is epoch-gated:
    // turn 1 sentence 1 + turn 2 sentence = exactly 2 buffers on the
    // wire; turn 1's second sentence never reaches the channel.
    expect(spoken.join(' ')).toContain('두번째 응답');
    expect(session.__sentAudio().length).toBe(2);
    await wire.shutdown();
  });

  it('barge-in echo guard drops finals matching the bot\'s own recent speech', async () => {
    const session = makeFakeSession();
    let sttOpts: StreamingSTTOpts | undefined;
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        sttOpts = opts;
        return {
          pushAudio: () => {},
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    const finals: string[] = [];
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (transcript, _ctx, cb) => {
        finals.push(transcript);
        cb.onChunk('지구와 태양의 평균 거리는 약 1억 4960만 킬로미터입니다. ');
        await cb.onDone('end_turn');
      },
      bargeIn: true,
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    sttOpts!.onFinal?.('거리 알려줘');
    await new Promise((r) => setTimeout(r, 30));
    // Echo of the bot's own sentence comes back through the mic → STT.
    sttOpts!.onFinal?.('평균 거리는 약 1억 4960만 킬로미터입니다');
    await new Promise((r) => setTimeout(r, 30));
    expect(finals).toEqual(['거리 알려줘']); // echo did NOT become a turn
    // A genuinely new utterance still passes.
    sttOpts!.onFinal?.('고마워 다음 주제로 가자');
    await new Promise((r) => setTimeout(r, 30));
    expect(finals.length).toBe(2);
    await wire.shutdown();
  });

  it('upsamples 16k inbound to 24k when the provider declares a 24 kHz format', async () => {
    // 2026-07-12 실측: openai-realtime(24k 세션)에 16k 를 그대로 밀면
    // 서버가 1.5배 빨리감기로 해석해 핵심 어휘가 깨진다. provider 선언
    // 포맷이 24k 면 push 경계에서 2:3 업샘플해야 한다.
    const session = makeFakeSession();
    const pushed: Buffer[] = [];
    const provider = {
      id: 'openai-realtime-stt',
      format: { sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
      openSession: async () => ({
        pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
        finalize: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        isOpen: () => true,
      } as StreamingSTTSession),
    } as unknown as StreamingSTTProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async () => {},
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    session.__emitAudio(Buffer.alloc(640), 'user-1'); // 20 ms @ 16 kHz
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    expect(pushed[0]!.length).toBe(960); // 20 ms @ 24 kHz (2:3)
    await wire.shutdown();
  });

  it('passes 16k inbound through untouched for 16 kHz providers (scribe)', async () => {
    const session = makeFakeSession();
    const pushed: Buffer[] = [];
    const provider = {
      id: 'elevenlabs-scribe-realtime',
      format: { sampleRate: 16_000, channels: 1, bitsPerSample: 16 },
      openSession: async () => ({
        pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
        finalize: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        isOpen: () => true,
      } as StreamingSTTSession),
    } as unknown as StreamingSTTProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async () => {},
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    session.__emitAudio(Buffer.alloc(640), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    expect(pushed[0]!.length).toBe(640);
    await wire.shutdown();
  });

  it('barge-in energy VAD: low-energy inbound during playback never interrupts', async () => {
    // 갭 #4 (2026-07-12): 기존 패킷 도착 카운트는 Discord 클라이언트의
    // 소음 게이트를 통과한 키보드/배경소음도 350ms 만 이어지면 지속
    // 발화로 오인했다. RMS 에너지 게이트는 저에너지(무음) 패킷을 아무리
    // 오래 보내도 admit 하지 않아야 한다.
    const session = makeFakeSession();
    let stopCalls = 0;
    (session as unknown as { stopPlayback: () => void }).stopPlayback = () => { stopCalls += 1; };
    const pushed: Buffer[] = [];
    let sttOpts: StreamingSTTOpts | undefined;
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        sttOpts = opts;
        return {
          pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    // Batch TTS: 4800 bytes @24k mono s16 = 100 ms of audio.
    const tts = {
      synthesizeBatch: async () => ({
        pcm: Buffer.alloc(4800),
        format: { sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
        charCount: 1,
      }),
    } as unknown as TTSProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_t, _ctx, cb) => {
        cb.onChunk('응답 문장입니다. ');
        await cb.onDone('end_turn');
      },
      bargeIn: true,
      echoClassifier: false,
      bargeInSustainMs: 60,
      selfEchoTailMs: 1000, // 테스트 내내 "봇 발화 중" 유지
      sttSilenceFinalizeMs: 10_000,
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => tts,
    });
    session.__emitAudio(Buffer.alloc(960), 'user-1'); // pre-speech open
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    sttOpts!.onFinal?.('질문');
    await new Promise((r) => setTimeout(r, 30)); // bot now speaking
    const stopCallsAfterFinal = stopCalls;
    // 200 ms 상당의 무음 패킷 연타 — 패킷 카운트라면 admit 됐을 길이.
    for (let i = 0; i < 10; i++) {
      session.__emitAudio(Buffer.alloc(960), 'user-1'); // 30 ms of silence each
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(pushed.length).toBe(1); // nothing reached STT
    expect(stopCalls).toBe(stopCallsAfterFinal); // no interrupt
    await wire.shutdown();
  });

  it('barge-in energy VAD: sustained loud speech interrupts playback and flows to STT', async () => {
    const session = makeFakeSession();
    let stopCalls = 0;
    (session as unknown as { stopPlayback: () => void }).stopPlayback = () => { stopCalls += 1; };
    const pushed: Buffer[] = [];
    let sttOpts: StreamingSTTOpts | undefined;
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        sttOpts = opts;
        return {
          pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    const tts = {
      synthesizeBatch: async () => ({
        pcm: Buffer.alloc(4800),
        format: { sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
        charCount: 1,
      }),
    } as unknown as TTSProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_t, _ctx, cb) => {
        cb.onChunk('응답 문장입니다. ');
        await cb.onDone('end_turn');
      },
      bargeIn: true,
      echoClassifier: false,
      bargeInSustainMs: 60,
      selfEchoTailMs: 1000,
      sttSilenceFinalizeMs: 10_000,
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => tts,
    });
    // 30 ms of loud speech per packet (amplitude 8000 ≈ RMS 0.24).
    const loud = Buffer.alloc(960);
    for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE((i / 2) % 2 === 0 ? 8000 : -8000, i);
    session.__emitAudio(loud, 'user-1'); // pre-speech open
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    sttOpts!.onFinal?.('질문');
    await new Promise((r) => setTimeout(r, 30)); // bot now speaking
    const stopCallsAfterFinal = stopCalls;
    for (let i = 0; i < 5; i++) {
      session.__emitAudio(loud, 'user-1');
      await new Promise((r) => setTimeout(r, 5));
    }
    // 60 ms 지속 임계 초과 → supersede(stopPlayback) + 이후 패킷은 STT 로.
    expect(stopCalls).toBeGreaterThan(stopCallsAfterFinal);
    expect(pushed.length).toBeGreaterThan(1);
    await wire.shutdown();
  });

  it('half-duplex gate drops inbound audio while the bot is audibly speaking', async () => {
    // 실기기 dogfood 2026-07-12: 스피커로 재생된 봇 목소리가 사용자
    // 마이크로 되돌아와 STT에 들어가 발화를 중단시킴. TTS 재생 지평선
    // (+tail) 동안 인바운드를 무시해야 한다.
    const session = makeFakeSession();
    const pushed: Buffer[] = [];
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        // capture final trigger via harness fake below
        (provider as unknown as { __opts: StreamingSTTOpts | undefined }).__opts = opts;
        return {
          pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    // Batch TTS: 4800 bytes @24k mono s16 = 100 ms of audio.
    const tts = {
      synthesizeBatch: async () => ({
        pcm: Buffer.alloc(4800),
        format: { sampleRate: 24_000, channels: 1, bitsPerSample: 16 },
        charCount: 1,
      }),
    } as unknown as TTSProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_t, _ctx, cb) => {
        cb.onChunk('응답 문장입니다. ');
        await cb.onDone('end_turn');
      },
      selfEchoTailMs: 40,
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => tts,
    });
    // Open the STT session with a first (pre-speech) audio chunk.
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    // Trigger a final → harness speaks 100 ms of TTS audio.
    (provider as unknown as { __opts: StreamingSTTOpts }).__opts.onFinal?.('질문');
    await new Promise((r) => setTimeout(r, 30));
    expect(session.__sentAudio().length).toBeGreaterThan(0);
    // While speaking (horizon ~100 ms + 40 ms tail): inbound dropped.
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(1);
    // After the horizon + tail passes: inbound flows again.
    await new Promise((r) => setTimeout(r, 160));
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed.length).toBe(2);
    await wire.shutdown();
  });

  it('rapid packets during a slow openSession share ONE session (no open race)', async () => {
    // 실기기 dogfood 2026-07-12: 20ms 간격 패킷이 수백 ms 걸리는
    // openSession 완료 전에 도착할 때마다 새 세션을 열어 200ms에 12개
    // 세션이 생기고 발화가 파편화 → "인식을 거의 못함". 오픈 프로미스
    // 메모이제이션으로 전 패킷이 같은 세션을 공유해야 한다.
    const session = makeFakeSession();
    let openCalls = 0;
    const pushed: Buffer[] = [];
    const provider = {
      openSession: async () => {
        openCalls += 1;
        await new Promise((r) => setTimeout(r, 30)); // slow open
        return {
          pushAudio: (pcm: Buffer) => { pushed.push(pcm); },
          finalize: () => Promise.resolve(),
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async () => {},
      sttSilenceFinalizeMs: 10_000, // keep the gap timer out of this test
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    for (let i = 0; i < 10; i++) session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 60));
    expect(openCalls).toBe(1);
    expect(pushed.length).toBe(10);
    await wire.shutdown();
  });

  it('silence gap force-finalizes the STT session and next audio reopens fresh', async () => {
    // Discord stops shipping packets on silence — server VAD alone
    // never sees the gap, so the harness must finalize client-side
    // (실기기 dogfood 2026-07-12: finals 안 옴/늦음/발화 병합).
    const session = makeFakeSession();
    let finalizeCalls = 0;
    let openCalls = 0;
    const provider = {
      openSession: async (opts?: StreamingSTTOpts) => {
        openCalls += 1;
        return {
          pushAudio: () => {},
          finalize: () => { finalizeCalls += 1; opts?.onFinal?.(''); return Promise.resolve(); },
          abort: () => Promise.resolve(),
          isOpen: () => true,
        } as StreamingSTTSession;
      },
    } as unknown as StreamingSTTProvider;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async () => {},
      sttSilenceFinalizeMs: 30,
      __sttProviderFactory: () => provider,
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(finalizeCalls).toBe(0); // gap not elapsed yet
    session.__emitAudio(Buffer.alloc(8), 'user-1'); // re-arms the timer
    await new Promise((r) => setTimeout(r, 60));
    expect(finalizeCalls).toBe(1); // gap elapsed once, finalized once
    expect(openCalls).toBe(1);
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(openCalls).toBe(2); // fresh session after finalize
    await wire.shutdown();
  });

  it('triggers runHarness on STT final and pipes deltas through TTS to sendAudio', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    let harnessText: string | null = null;
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (transcript, _ctx, cb) => {
        harnessText = transcript;
        await cb.onChunk('Hello');
        await cb.onChunk(' world.');
        await cb.onDone('end_turn');
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    // Prime the session by pushing audio (so STT session is open).
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    // Now fire the final transcript.
    harness.triggerFinal('hello there');
    // Wait for the runHarness path to complete + TTS chunks to drain.
    await new Promise((r) => setTimeout(r, 30));
    expect(harnessText).toBe('hello there');
    expect(session.__sentAudio().length).toBe(1);
    expect(ttsBundle.lastSpoken()).toEqual(['Hello world.']);
    await wire.shutdown();
  });

  it('flushes trailing remainder at end_turn even without sentence punctuation', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('unfinished trailing text');
        await cb.onDone('end_turn');
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('go');
    await new Promise((r) => setTimeout(r, 30));
    expect(ttsBundle.lastSpoken()).toEqual(['unfinished trailing text']);
    await wire.shutdown();
  });

  it('uses speakable text for live voice-channel tts chunks', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('문서는 https://example.com/docs 에 있고 경로는 /tmp/demo.txt 입니다.');
        await cb.onDone('end_turn');
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('go');
    await new Promise((r) => setTimeout(r, 30));
    expect(ttsBundle.lastSpoken()).toEqual(['문서는 link 에 있고 경로는 path 입니다.']);
    await wire.shutdown();
  });

  it('caller-only filter blocks foreign userId audio at the wire level', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c', listenFilterUserId: 'caller-only' },
      runHarness: async () => {},
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'foreign-user');
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.pushedChunks.length).toBe(0);
    session.__emitAudio(Buffer.alloc(8), 'caller-only');
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.pushedChunks.length).toBe(1);
    await wire.shutdown();
  });

  it('cancelled harness turn stops further TTS chunks', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('first.');
        await cb.onDone('cancelled');
        await cb.onChunk('second-after-cancel');
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('go');
    await new Promise((r) => setTimeout(r, 30));
    // First sentence lands before cancel; later chunk is suppressed.
    expect(ttsBundle.lastSpoken()).toEqual(['first.']);
    await wire.shutdown();
  });

  it('intercepts spoken intake transcripts before ACP harness execution', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    let harnessCalled = false;
    let mirroredAssistant = '';
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      interceptTranscript: async (transcript) => (
        transcript.startsWith('intake ')
          ? 'I captured that as intake intake-voice.'
          : null
      ),
      runHarness: async () => {
        harnessCalled = true;
      },
      onAssistantTranscript: async (_delta, full) => {
        mirroredAssistant = full;
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('intake compare two repos');
    await new Promise((r) => setTimeout(r, 30));
    expect(harnessCalled).toBe(false);
    expect(mirroredAssistant).toContain('I captured that as intake intake-voice.');
    expect(ttsBundle.lastSpoken()).toEqual(['I captured that as intake intake-voice.']);
    await wire.shutdown();
  });

  it('intercepts spoken latest-apply follow-ups before ACP harness execution', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const ttsBundle = makeFakeTtsProvider();
    let harnessCalled = false;
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      interceptTranscript: async (transcript) => maybeHandleSpokenVoiceIntake({
        transcript,
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        createIntakeId: () => 'intake-voice-harness',
      }),
      runHarness: async () => {
        harnessCalled = true;
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => ttsBundle.provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('intake compare two repos');
    await new Promise((r) => setTimeout(r, 20));
    harness.triggerFinal('intake apply');
    await new Promise((r) => setTimeout(r, 30));
    const spoken = ttsBundle.lastSpoken();
    expect(harnessCalled).toBe(false);
    expect(spoken[0]).toContain('I captured that as intake');
    expect(spoken.some((chunk) => chunk.includes('I updated intake intake-voice-harness.'))).toBe(true);
    expect(spoken.some((chunk) => chunk.includes('TaskDecomposeApply'))).toBe(true);
    expect(graph.size()).toBe(1);
    await wire.shutdown();
  });

  it('reuses the daemon TTS singleton when no explicit TTS factory is supplied', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const spoken: string[] = [];
    const restoreTts = setDaemonTtsProviderForTesting({
      id: 'openai-tts',
      format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
      synthesizeStream: async function* (text: string): AsyncIterable<TTSStreamChunk> {
        spoken.push(text);
        yield { pcm: Buffer.alloc(4) };
      },
      synthesizeBatch: async (text: string) => ({
        pcm: Buffer.from(text),
        format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
        charCount: text.length,
      }),
    } as TTSProvider);
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('singleton hello');
        await cb.onDone('end_turn');
      },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
    });

    try {
      session.__emitAudio(Buffer.alloc(8), 'user-1');
      await new Promise((r) => setTimeout(r, 5));
      harness.triggerFinal('go');
      await new Promise((r) => setTimeout(r, 30));
      expect(spoken).toEqual(['singleton hello']);
    } finally {
      restoreTts();
      await wire.shutdown();
    }
  });

  it('fires transcript hooks for partial, final, and assistant chunks', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const partials: string[] = [];
    const finals: string[] = [];
    const assistants: string[] = [];
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c', textChannelId: 't1' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('Hello');
        await cb.onChunk(' world.');
        await cb.onDone('end_turn');
      },
      onPartialTranscript: (partial) => { partials.push(partial); },
      onFinalTranscript: (final) => { finals.push(final); },
      onAssistantTranscript: (_delta, full) => { assistants.push(full); },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });

    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    opened.value?.onPartial?.('hel');
    harness.triggerFinal('hello there');
    await new Promise((r) => setTimeout(r, 30));

    expect(partials).toEqual(['hel']);
    expect(finals).toEqual(['hello there']);
    expect(assistants).toEqual(['Hello', 'Hello world.']);
    await wire.shutdown();
  });

  it('fires onTurnComplete after assistant audio drains', async () => {
    const session = makeFakeSession();
    const harness: FakeSttHarness = {
      pushedChunks: [],
      triggerFinal: () => {},
      triggerError: () => {},
    };
    const opened = { value: null as StreamingSTTOpts | null };
    const completed: string[] = [];
    const wire = wireDiscordSessionToHarness({
      session,
      joinOpts: { guildId: 'g', channelId: 'c', textChannelId: 't1' },
      runHarness: async (_transcript, _ctx, cb) => {
        await cb.onChunk('done.');
        await cb.onDone('end_turn');
      },
      onTurnComplete: (reason) => { completed.push(reason); },
      __sttProviderFactory: () => makeFakeSttProvider(harness, opened),
      __ttsProviderFactory: () => makeFakeTtsProvider().provider,
    });
    session.__emitAudio(Buffer.alloc(8), 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    harness.triggerFinal('go');
    await new Promise((r) => setTimeout(r, 30));
    expect(completed).toEqual(['end_turn']);
    await wire.shutdown();
  });
});
