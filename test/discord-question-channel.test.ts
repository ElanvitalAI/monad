// C1 (2026-07-12) — Discord AskUserQuestion 버튼 채널 테스트: 렌더/버튼
// 구조, 탭→answers resolve, 다중 질문 순차, 취소, 미소유 인터랙션 무시.

import { describe, expect, test } from 'bun:test';
import { createDiscordQuestionRuntime, type DiscordQuestionBot } from '../src/discord-question-channel.js';
import type { AskUserQuestionRequest } from '../src/ask-user-question/types.js';

function makeBot(): {
  bot: DiscordQuestionBot;
  sent: Array<{ channelId: string; text: string; components: unknown[] }>;
  edits: Array<{ messageId: string; text: string }>;
} {
  const sent: Array<{ channelId: string; text: string; components: unknown[] }> = [];
  const edits: Array<{ messageId: string; text: string }> = [];
  let n = 0;
  return {
    sent, edits,
    bot: {
      sendMessageWithComponents: async (channelId, text, components) => {
        sent.push({ channelId, text, components: [...components] });
        n += 1;
        return { id: `m${n}` };
      },
      editMessage: async (_ch, messageId, text) => { edits.push({ messageId, text }); },
    },
  };
}

const fakeFetch = (async () => ({ ok: true, status: 204, json: async () => ({}) })) as unknown as typeof fetch;

function tap(customId: string): Record<string, unknown> {
  return { type: 3, id: 'i9', token: 't9', data: { custom_id: customId } };
}

const REQ: AskUserQuestionRequest = {
  questions: [{
    id: 'approach', header: '방식', question: '어떤 접근으로 갈까요?',
    multiSelect: false,
    options: [
      { label: '점진 리팩터', description: '안전·느림' },
      { label: '전면 재작성', description: '빠름·위험' },
    ],
  }],
};

describe('discord question channel (C1)', () => {
  test('ask renders buttons; tap resolves answers and edits the message', async () => {
    const { bot, sent, edits } = makeBot();
    const rt = createDiscordQuestionRuntime({ getBot: () => bot, __fetchImpl: fakeFetch });
    const ch = rt.channelFor('CH-1');
    const p = ch.ask(REQ);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('[방식]');
    expect(sent[0]!.text).toContain('점진 리팩터');
    const row = sent[0]!.components[0] as { components: Array<{ custom_id: string; label: string }> };
    expect(row.components).toHaveLength(2);
    const secondId = row.components[1]!.custom_id;
    expect(secondId).toMatch(/^monad-q:/);
    expect(await rt.handleComponentInteraction(tap(secondId))).toBe(true);
    const result = await p;
    expect(result).toEqual({ answers: { approach: '전면 재작성' } });
    expect(edits[0]!.text).toContain('✅ **전면 재작성**');
  });

  test('multi-question: sequential render, both answers collected', async () => {
    const { bot, sent } = makeBot();
    const rt = createDiscordQuestionRuntime({ getBot: () => bot, __fetchImpl: fakeFetch });
    const ch = rt.channelFor('CH-1');
    const req: AskUserQuestionRequest = {
      questions: [
        { ...REQ.questions[0]! },
        { id: 'scope', header: '범위', question: '범위는?', multiSelect: true,
          options: [{ label: '코어만', description: 'x' }, { label: '전체', description: 'y' }] },
      ],
    };
    const p = ch.ask(req);
    await new Promise((r) => setTimeout(r, 0));
    const id1 = (sent[0]!.components[0] as { components: Array<{ custom_id: string }> }).components[0]!.custom_id;
    await rt.handleComponentInteraction(tap(id1));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(2); // second question rendered
    expect(sent[1]!.text).toContain('질문 2/2');
    const id2 = (sent[1]!.components[0] as { components: Array<{ custom_id: string }> }).components[1]!.custom_id;
    await rt.handleComponentInteraction(tap(id2));
    const result = await p;
    // multiSelect answer lands as a single-element array (v1 semantics).
    expect(result).toEqual({ answers: { approach: '점진 리팩터', scope: ['전체'] } });
  });

  test('cancel settles null and edits the prompt (race-loser cleanup)', async () => {
    const { bot, edits } = makeBot();
    const rt = createDiscordQuestionRuntime({ getBot: () => bot, __fetchImpl: fakeFetch });
    const ch = rt.channelFor('CH-1');
    const p = ch.ask(REQ);
    await new Promise((r) => setTimeout(r, 0));
    await ch.cancel();
    expect(await p).toBeNull();
    expect(edits[0]!.text).toContain('질문 종료');
  });

  test('foreign interactions are not consumed; stale monad-q taps are', async () => {
    const { bot } = makeBot();
    const rt = createDiscordQuestionRuntime({ getBot: () => bot, __fetchImpl: fakeFetch });
    expect(await rt.handleComponentInteraction({ type: 2, data: { name: 'cc' } })).toBe(false);
    expect(await rt.handleComponentInteraction(tap('other-prefix:x:0'))).toBe(false);
    expect(await rt.handleComponentInteraction(tap('monad-q:ghost:0'))).toBe(true); // ours, stale — consumed
  });

  test('no bot → ask returns null (dropped from the race)', async () => {
    const rt = createDiscordQuestionRuntime({ getBot: () => null, __fetchImpl: fakeFetch });
    expect(await rt.channelFor('CH-1').ask(REQ)).toBeNull();
  });
});
