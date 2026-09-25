import { describe, expect, it } from 'bun:test';
import {
  createDiscordVoiceAdapter,
  DiscordVoiceUnavailableError,
  normalizeDiscordVoiceReplyMode,
  type DiscordVoiceCodec,
} from '../src/voice/channel-adapters/discord-voice-adapter';
import type { STTProvider } from '../src/voice/stt-provider';
import type { TTSProvider } from '../src/voice/tts/tts-provider';

function fakeCodec(): { codec: DiscordVoiceCodec; inputs: Buffer[]; pcm24kIn: Buffer[] } {
  const inputs: Buffer[] = [];
  const pcm24kIn: Buffer[] = [];
  return {
    codec: {
      async inputToPcm16k(input) {
        inputs.push(input);
        return Buffer.from(`PCM16k(${input.toString()})`);
      },
      async pcm24kToOutput(pcm) {
        pcm24kIn.push(pcm);
        return Buffer.from(`OGG(${pcm.toString()})`);
      },
    },
    inputs,
    pcm24kIn,
  };
}

function fakeStt(): { provider: STTProvider; calls: Array<{ pcm: Buffer; lang?: string }>; nextResult: { text: string; language?: string } } {
  const calls: Array<{ pcm: Buffer; lang?: string }> = [];
  const handle = { nextResult: { text: '디스코드 전사', language: 'ko' } };
  const provider: STTProvider = {
    id: 'openai-whisper',
    async transcribeBatch(pcm, opts) {
      calls.push({ pcm, lang: opts?.language });
      return handle.nextResult;
    },
  };
  return { provider, calls, ...handle };
}

function fakeTts(): { provider: TTSProvider; calls: string[]; nextPcm: Buffer } {
  const calls: string[] = [];
  const handle = { nextPcm: Buffer.from('TTS-PCM-24K') };
  const provider: TTSProvider = {
    id: 'openai-tts',
    format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
    async synthesizeBatch(text) {
      calls.push(text);
      return { pcm: handle.nextPcm, format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 }, charCount: text.length };
    },
  };
  return { provider, calls, ...handle };
}

describe('createDiscordVoiceAdapter — availability', () => {
  it('reports unavailable when sttProvider missing', () => {
    const { codec } = fakeCodec();
    const a = createDiscordVoiceAdapter({ sttProvider: null, codec });
    expect(a.available).toBe(false);
    expect(a.unavailableReason).toContain('sttProvider');
  });

  it('available with sttProvider supplied', () => {
    const { codec } = fakeCodec();
    const { provider } = fakeStt();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, codec });
    expect(a.available).toBe(true);
    expect(a.unavailableReason).toBeNull();
  });

  it('transcribeAttachment rejects when adapter unavailable', async () => {
    const { codec } = fakeCodec();
    const a = createDiscordVoiceAdapter({ sttProvider: null, codec });
    await expect(a.transcribeAttachment(Buffer.from('x'))).rejects.toThrow(DiscordVoiceUnavailableError);
  });
});

describe('createDiscordVoiceAdapter — transcribeAttachment', () => {
  it('decodes input via codec then sends PCM to STT', async () => {
    const { codec, inputs } = fakeCodec();
    const { provider, calls } = fakeStt();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, codec });
    const result = await a.transcribeAttachment(Buffer.from('OGG-A'));
    expect(inputs.map((b) => b.toString())).toEqual(['OGG-A']);
    expect(calls.length).toBe(1);
    expect(calls[0]!.pcm.toString()).toBe('PCM16k(OGG-A)');
    expect(result.transcript).toBe('디스코드 전사');
    expect(result.language).toBe('ko');
  });

  it('forwards opts.language → STT', async () => {
    const { codec } = fakeCodec();
    const { provider, calls } = fakeStt();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, codec });
    await a.transcribeAttachment(Buffer.from('x'), undefined, { language: 'en' });
    expect(calls[0]?.lang).toBe('en');
  });

  it('falls back to adapter voiceLanguage when lang missing', async () => {
    const { codec } = fakeCodec();
    const { provider, calls } = fakeStt();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, codec, voiceLanguage: 'ko' });
    await a.transcribeAttachment(Buffer.from('x'));
    expect(calls[0]?.lang).toBe('ko');
  });
});

describe('createDiscordVoiceAdapter — generateReply', () => {
  it("'auto' + fromVoice=true → voice attachment", async () => {
    const { codec, pcm24kIn } = fakeCodec();
    const { provider } = fakeStt();
    const tts = fakeTts();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, ttsProvider: tts.provider, codec });
    const reply = await a.generateReply('응답', { fromVoice: true });
    expect(reply.text).toBe('응답');
    expect(reply.voiceAttachment).not.toBeNull();
    expect(pcm24kIn.length).toBe(1);
    expect(tts.calls).toEqual(['응답']);
  });

  it("'auto' + fromVoice=false → text only", async () => {
    const { codec, pcm24kIn } = fakeCodec();
    const { provider } = fakeStt();
    const tts = fakeTts();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, ttsProvider: tts.provider, codec });
    const reply = await a.generateReply('hi', { fromVoice: false });
    expect(reply.voiceAttachment).toBeNull();
    expect(pcm24kIn.length).toBe(0);
  });

  it("'voice' overrides → voice attachment even on text input", async () => {
    const { codec } = fakeCodec();
    const { provider } = fakeStt();
    const tts = fakeTts();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, ttsProvider: tts.provider, codec, replyMode: 'voice' });
    const reply = await a.generateReply('안녕', { fromVoice: false });
    expect(reply.voiceAttachment).not.toBeNull();
  });

  it('falls back to text-only when ttsProvider missing', async () => {
    const { codec } = fakeCodec();
    const { provider } = fakeStt();
    const a = createDiscordVoiceAdapter({ sttProvider: provider, codec, replyMode: 'voice' });
    const reply = await a.generateReply('안녕', { fromVoice: true });
    expect(reply.voiceAttachment).toBeNull();
  });
});

describe('normalizeDiscordVoiceReplyMode', () => {
  it('preserves text / voice / auto', () => {
    expect(normalizeDiscordVoiceReplyMode('text')).toBe('text');
    expect(normalizeDiscordVoiceReplyMode('voice')).toBe('voice');
    expect(normalizeDiscordVoiceReplyMode('auto')).toBe('auto');
  });

  it('coerces unknown / wrong types to auto', () => {
    expect(normalizeDiscordVoiceReplyMode('weird')).toBe('auto');
    expect(normalizeDiscordVoiceReplyMode(undefined)).toBe('auto');
    expect(normalizeDiscordVoiceReplyMode(123)).toBe('auto');
  });
});
