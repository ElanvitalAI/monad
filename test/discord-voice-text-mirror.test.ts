import { describe, expect, it } from 'bun:test';
import { createDiscordVoiceTextMirror } from '../src/voice/channel-adapters/discord-voice-text-mirror.js';

describe('createDiscordVoiceTextMirror', () => {
  it('posts partial, settles final, and streams assistant text by edit', async () => {
    const sent: string[] = [];
    const edited: Array<{ id: string; text: string }> = [];
    let seq = 0;
    const mirror = createDiscordVoiceTextMirror({
      editGapMs: 0,
      sendMessage: async (text) => {
        sent.push(text);
        seq += 1;
        return { id: `m${seq}` };
      },
      editMessage: async (id, text) => {
        edited.push({ id, text });
      },
    });

    mirror.setListening();
    await new Promise((r) => setTimeout(r, 0));
    mirror.pushPartial('hello');
    await new Promise((r) => setTimeout(r, 0));
    await mirror.commitFinal('hello world');
    mirror.pushAssistant('reply one');
    await new Promise((r) => setTimeout(r, 0));
    mirror.pushAssistant('reply one two');
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toEqual([
      '👂 Listening…',
      '🤖 reply one',
    ]);
    expect(edited).toEqual([
      { id: 'm1', text: '🎙️ Hearing: hello' },
      { id: 'm1', text: '🎙️ User: hello world' },
      { id: 'm2', text: '🤖 reply one two' },
    ]);
  });

  it('keeps discord fan-out text raw even when a speakable rewrite exists', async () => {
    const sent: string[] = [];
    let seq = 0;
    const mirror = createDiscordVoiceTextMirror({
      editGapMs: 0,
      sendMessage: async (text) => {
        sent.push(text);
        seq += 1;
        return { id: `m${seq}` };
      },
      editMessage: async () => {},
    });

    mirror.pushAssistant('경로는 /tmp/demotxt 입니다.');
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toEqual(['🤖 경로는 /tmp/demotxt 입니다.']);
  });
});
