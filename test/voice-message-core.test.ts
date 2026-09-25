import { describe, expect, it } from 'bun:test';
import {
  buildSpeakableVoiceReplyText,
  generateVoiceMessageReply,
  type VoiceMessageCodec,
} from '../src/voice/channel-adapters/voice-message-core';
import type { TTSProvider } from '../src/voice/tts/tts-provider';

function fakeCodec(): { codec: VoiceMessageCodec; pcm24kIn: Buffer[] } {
  const pcm24kIn: Buffer[] = [];
  return {
    codec: {
      async inputToPcm16k(input) {
        return input;
      },
      async pcm24kToOutput(pcm) {
        pcm24kIn.push(pcm);
        return Buffer.from(`OUT(${pcm.toString()})`);
      },
    },
    pcm24kIn,
  };
}

function fakeTts(): { provider: TTSProvider; calls: string[] } {
  const calls: string[] = [];
  const provider: TTSProvider = {
    id: 'openai-tts',
    format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
    async synthesizeBatch(text) {
      calls.push(text);
      return {
        pcm: Buffer.from('TTS-PCM-24K'),
        format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
        charCount: text.length,
      };
    },
  };
  return { provider, calls };
}

describe('buildSpeakableVoiceReplyText', () => {
  it('drops markdown links, urls, code fences, and unix paths', () => {
    const input = [
      '요약입니다.',
      '```ts',
      "console.log('debug')",
      '```',
      '참고: [docs](https://example.com/docs)',
      '경로는 /Users/me/source/axon/monad-agent/src/index.ts 입니다.',
    ].join('\n');
    expect(buildSpeakableVoiceReplyText(input)).toBe('요약입니다. 참고: docs 경로는 path 입니다.');
  });

  it('caps overly long speech text', () => {
    const input = 'a'.repeat(600);
    const output = buildSpeakableVoiceReplyText(input);
    expect(output.length).toBeLessThanOrEqual(480);
    expect(output.endsWith('...')).toBe(true);
  });
});

describe('generateVoiceMessageReply', () => {
  it('uses speakable text for TTS but preserves original text payload', async () => {
    const { codec, pcm24kIn } = fakeCodec();
    const tts = fakeTts();
    const replyText = '읽어줄 때는 `const x = 1` 과 https://example.com/test 그리고 /tmp/demo.txt 는 줄여주세요.';
    const reply = await generateVoiceMessageReply(codec, tts.provider, 'voice', replyText, {
      fromVoice: true,
    });
    expect(reply.text).toBe(replyText);
    expect(reply.voiceBlob).not.toBeNull();
    expect(pcm24kIn.length).toBe(1);
    expect(tts.calls).toEqual(['읽어줄 때는 const x = 1 과 link 그리고 path 는 줄여주세요.']);
  });
});
