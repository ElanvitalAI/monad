// Tests for the production createDiscordVoiceChannelAdapter wire
// (Phase 6 wire · 2026-04-30). Uses the __voiceModuleLoader and
// __opusFactory test seams to inject a fake `@discordjs/voice`
// module + opus codec stand-ins so we can verify the adapter:
//   - waits for VoiceConnectionStatus.Ready before returning
//   - decodes inbound Opus → 16k mono PCM via onAudioReceived
//   - encodes outbound 24k mono PCM → 48k stereo Opus on sendAudio
//   - tears down on leave (player.stop, pcm.end, connection.destroy)

import { describe, it, expect } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Readable, PassThrough, Transform } from 'node:stream';
import {
  createDiscordVoiceChannelAdapter,
  DiscordVoiceUnavailableError,
  type DiscordVoiceModule,
  type OpusCodecFactory,
} from '../src/voice/channel-adapters/discord-voice-channel-adapter.js';

function makeStubCoordinator() {
  return {
    tap: {},
    getBotUserId: () => null,
    getSessionId: () => null,
    createAdapterFor: () => () => ({ sendPayload: () => true, destroy: () => {} }),
    destroyAll: () => {},
  } as unknown as Parameters<typeof createDiscordVoiceChannelAdapter>[0]['coordinator'];
}

interface FakeConnection {
  receiver: {
    subscribe: ReturnType<typeof makeSubscribeStub>;
    speaking: { on(event: 'start' | 'end', cb: (userId: string) => void): void };
    __emitSpeakingStart(userId: string): void;
  };
  on(event: string, cb: (...args: unknown[]) => void): void;
  once(event: string, cb: (...args: unknown[]) => void): void;
  subscribe(): { unsubscribe(): void };
  destroy(): void;
  __destroyed: boolean;
  __emitState(state: string): void;
  __subscribedSpeakers: Map<string, { stream: PassThrough; opts: any }>;
  __outboundEncoder: PassThrough | null;
}

function makeSubscribeStub(connection: { __subscribedSpeakers: Map<string, { stream: PassThrough; opts: any }> }) {
  return (userId: string, opts: any) => {
    const stream = new PassThrough();
    connection.__subscribedSpeakers.set(userId, { stream, opts });
    return stream as unknown as Readable;
  };
}

function makeFakeVoiceModule(): { mod: DiscordVoiceModule; lastConnection: () => FakeConnection | null } {
  let lastConnection: FakeConnection | null = null;
  const mod: DiscordVoiceModule = {
    joinVoiceChannel: () => {
      const speakingHandlers = new Map<'start' | 'end', Array<(userId: string) => void>>();
      const stateHandlers: Array<(...args: unknown[]) => void> = [];
      const conn: FakeConnection = {
        __destroyed: false,
        __subscribedSpeakers: new Map(),
        __outboundEncoder: null,
        receiver: {
          subscribe: undefined as any,
          speaking: {
            on: (event, cb) => {
              if (!speakingHandlers.has(event)) speakingHandlers.set(event, []);
              speakingHandlers.get(event)!.push(cb);
            },
          },
          __emitSpeakingStart: (userId) => {
            for (const cb of speakingHandlers.get('start') ?? []) cb(userId);
          },
        },
        on: (event, cb) => { if (event === 'stateChange') stateHandlers.push(cb); },
        once: () => {},
        subscribe: () => ({ unsubscribe: () => {} }),
        destroy: () => { conn.__destroyed = true; },
        __emitState: (state) => {
          for (const cb of stateHandlers) cb({}, { status: state });
        },
      };
      conn.receiver.subscribe = makeSubscribeStub(conn);
      lastConnection = conn;
      return conn as any;
    },
    entersState: async (target: any, _state: string, _timeoutMs: number) => {
      // Pretend we instantly reached Ready.
      target.__emitState('ready');
      return target;
    },
    createAudioPlayer: () => {
      let lastResource: any = null;
      return {
        play: (resource: any) => { lastResource = resource; },
        stop: () => true,
        on: () => {},
        __lastResource: () => lastResource,
      } as any;
    },
    createAudioResource: (input: Readable) => {
      // The adapter pipes pcm48Stereo → encoder → resource. We just
      // record the encoder so tests can assert outbound writes.
      if (lastConnection) lastConnection.__outboundEncoder = input as unknown as PassThrough;
      return { __resource: true } as any;
    },
    VoiceConnectionStatus: {
      Ready: 'ready',
      Connecting: 'connecting',
      Disconnected: 'disconnected',
      Destroyed: 'destroyed',
      Signalling: 'signalling',
    },
    EndBehaviorType: { AfterSilence: 1, Manual: 0 },
    StreamType: { Raw: 'raw', Opus: 'opus', OggOpus: 'ogg/opus' },
    AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
  };
  return { mod, lastConnection: () => lastConnection };
}

function makeFakeOpusFactory(): { factory: OpusCodecFactory; readDecoderInputs: () => Buffer[]; readEncoderInputs: () => Buffer[] } {
  const decoderInputs: Buffer[] = [];
  const encoderInputs: Buffer[] = [];
  return {
    readDecoderInputs: () => decoderInputs.slice(),
    readEncoderInputs: () => encoderInputs.slice(),
    factory: {
      createDecoder: () => {
        // Transform stream — `_transform` pushes a fixed 24-byte
        // 48k-stereo PCM block per inbound Opus packet. Real prism
        // decoder emits 960-sample frames; the wire treats whatever
        // bytes the decoder emits as 48k stereo PCM, so a constant
        // 6-frame (24-byte) synth is plenty for verifying the
        // resample math.
        return new Transform({
          transform(chunk: Buffer, _enc, cb) {
            decoderInputs.push(Buffer.from(chunk));
            const fakePcm = Buffer.alloc(24);
            for (let i = 0; i < 6; i++) {
              fakePcm.writeInt16LE(100, i * 4);     // L
              fakePcm.writeInt16LE(100, i * 4 + 2); // R
            }
            this.push(fakePcm);
            cb();
          },
        }) as unknown as NodeJS.ReadWriteStream;
      },
      createEncoder: () => {
        // Encoder transform: just records inbound writes and passes
        // through. We never inspect encoded output (the AudioResource
        // marker is opaque); only the resampler input shape matters.
        return new Transform({
          transform(chunk: Buffer, _enc, cb) {
            encoderInputs.push(Buffer.from(chunk));
            cb(null, chunk);
          },
        }) as unknown as NodeJS.ReadWriteStream;
      },
    },
  };
}

describe('createDiscordVoiceChannelAdapter (production wire)', () => {
  it('joinChannel waits for Ready and returns a session', async () => {
    const { mod } = makeFakeVoiceModule();
    const { factory } = makeFakeOpusFactory();
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.resolve(mod),
      __opusFactory: factory,
    });
    const session = await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    expect(session.getState()).toBe('ready');
    await session.leave();
  });

  it('inbound speaker audio is decoded and forwarded as 16k mono', async () => {
    const { mod, lastConnection } = makeFakeVoiceModule();
    const { factory } = makeFakeOpusFactory();
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.resolve(mod),
      __opusFactory: factory,
    });
    const session = await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    const received: Array<{ pcm: Buffer; userId: string }> = [];
    session.onAudioReceived((pcm, userId) => received.push({ pcm, userId }));

    // Simulate a speaker starting — adapter should subscribe a Readable.
    const conn = lastConnection()!;
    conn.receiver.__emitSpeakingStart('user-99');
    const sub = conn.__subscribedSpeakers.get('user-99');
    expect(sub).toBeTruthy();
    // Push 60 bytes (15 stereo frames @ 48k) of Opus packets — the
    // fake decoder emits 6-frame 48k stereo PCM blocks per write.
    sub!.stream.write(Buffer.alloc(60));
    // Wait one microtask for the decoder data event to drain.
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBeGreaterThan(0);
    // 6 frames @ 48k stereo → 2 frames @ 16k mono → 4 bytes
    expect(received[0]!.pcm.length).toBe(4);
    expect(received[0]!.userId).toBe('user-99');
    await session.leave();
  });

  it('listenFilterUserId blocks foreign speakers', async () => {
    const { mod, lastConnection } = makeFakeVoiceModule();
    const { factory } = makeFakeOpusFactory();
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.resolve(mod),
      __opusFactory: factory,
    });
    const session = await adapter.joinChannel({
      guildId: 'g',
      channelId: 'c',
      listenFilterUserId: 'caller-only',
    });
    const conn = lastConnection()!;
    conn.receiver.__emitSpeakingStart('foreign-user');
    expect(conn.__subscribedSpeakers.has('foreign-user')).toBe(false);
    conn.receiver.__emitSpeakingStart('caller-only');
    expect(conn.__subscribedSpeakers.has('caller-only')).toBe(true);
    await session.leave();
  });

  it('sendAudio writes 24k mono PCM upsampled to 48k stereo through encoder', async () => {
    const { mod } = makeFakeVoiceModule();
    const { factory, readEncoderInputs } = makeFakeOpusFactory();
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.resolve(mod),
      __opusFactory: factory,
    });
    const session = await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    // 6 mono frames @ 24k = 12 bytes input
    // → 2× upsample to 48k = 12 mono frames
    // → channel duplicate to stereo = 12 stereo frames × 4 bytes = 48 bytes
    const inputPcm = Buffer.alloc(12);
    for (let i = 0; i < 6; i++) inputPcm.writeInt16LE(500, i * 2);
    session.sendAudio(inputPcm);
    // Allow the PassThrough write to drain to the encoder.
    await new Promise((r) => setImmediate(r));
    const encInputs = readEncoderInputs();
    expect(encInputs.length).toBeGreaterThan(0);
    const total = encInputs.reduce((acc, b) => acc + b.length, 0);
    expect(total).toBe(48);
    await session.leave();
  });

  it('odd-byte chunk boundaries keep int16 alignment (TTS stream chunking)', async () => {
    // 실기기 dogfood 2026-07-12: openai-tts는 HTTP body 청크를 그대로
    // yield — 16-bit 샘플이 청크 경계에서 쪼개지면 이후 전부 굉음.
    // 홀수 바이트 캐리로 정렬이 유지되어, 아무렇게나 쪼개 보내도
    // 통짜로 보낸 것과 인코더 입력이 byte-identical해야 한다.
    async function encodeVia(chunks: Buffer[]): Promise<Buffer> {
      const { mod } = makeFakeVoiceModule();
      const { factory, readEncoderInputs } = makeFakeOpusFactory();
      const adapter = createDiscordVoiceChannelAdapter({
        coordinator: makeStubCoordinator()!,
        __voiceModuleLoader: () => Promise.resolve(mod),
        __opusFactory: factory,
      });
      const session = await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
      for (const c of chunks) session.sendAudio(c);
      await new Promise((r) => setImmediate(r));
      const out = Buffer.concat(readEncoderInputs());
      await session.leave();
      return out;
    }
    // 7 samples of a recognizable ramp.
    const whole = Buffer.alloc(14);
    for (let i = 0; i < 7; i++) whole.writeInt16LE(1000 + i, i * 2);
    const wholeOut = await encodeVia([whole]);
    // Split at ODD offsets 3 and 8 — both cuts land mid-sample.
    const splitOut = await encodeVia([
      whole.subarray(0, 3),
      whole.subarray(3, 8),
      whole.subarray(8),
    ]);
    expect(wholeOut.length).toBe(7 * 8); // 7 mono → ×2 upsample ×4B stereo
    expect(splitOut.equals(wholeOut)).toBe(true);
  });

  it('leave destroys the connection and transitions to disconnected', async () => {
    const { mod, lastConnection } = makeFakeVoiceModule();
    const { factory } = makeFakeOpusFactory();
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.resolve(mod),
      __opusFactory: factory,
    });
    const session = await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    const states: string[] = [];
    session.onStateChange((s) => states.push(s));
    await session.leave();
    expect(session.getState()).toBe('disconnected');
    expect(lastConnection()!.__destroyed).toBe(true);
    expect(states).toContain('disconnected');
  });

  it('joinChannel rejects with DiscordVoiceUnavailableError when loader fails', async () => {
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => Promise.reject(new Error('nope')),
    });
    let err: Error | null = null;
    try { await adapter.joinChannel({ guildId: 'g', channelId: 'c' }); }
    catch (e) { err = e instanceof Error ? e : new Error(String(e)); }
    expect(err).toBeInstanceOf(DiscordVoiceUnavailableError);
  });

  it('shutdown invalidates further joins (re-probe required)', async () => {
    const { mod } = makeFakeVoiceModule();
    const { factory } = makeFakeOpusFactory();
    let loaderCalls = 0;
    const adapter = createDiscordVoiceChannelAdapter({
      coordinator: makeStubCoordinator()!,
      __voiceModuleLoader: () => { loaderCalls += 1; return Promise.resolve(mod); },
      __opusFactory: factory,
    });
    await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    expect(loaderCalls).toBe(1);
    await adapter.shutdown();
    await adapter.joinChannel({ guildId: 'g', channelId: 'c' });
    expect(loaderCalls).toBe(2);
  });
});
