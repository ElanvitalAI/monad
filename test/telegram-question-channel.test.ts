// Multi-option Telegram HITL QuestionChannel — single-select,
// multiSelect (toggle + Done), Other free-text (next-message capture),
// multi-question walk, and cancel.

import { describe, expect, test } from 'bun:test';
import { createTelegramSurfaceHitl } from '../src/hitl/telegram-surface-hitl';
import type { TgCallbackQuery } from '../src/telegram';
import type { AskUserQuestionRequest } from '../src/ask-user-question/types';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Sent { chatId: number; text: string; buttons: Array<Array<{ text: string; data: string }>> }

function makeFakeBot() {
  const sent: Sent[] = [];
  let cb: ((q: TgCallbackQuery) => Promise<void> | void) | null = null;
  let textResolver: ((t: string | null) => void) | null = null;
  let mid = 500;
  const bot = {
    onCallbackQuery(h: (q: TgCallbackQuery) => Promise<void> | void) { cb = h; return () => { cb = null; }; },
    async sendInlineKeyboard(chatId: number, text: string, buttons: Array<Array<{ text: string; data: string }>>) {
      sent.push({ chatId, text, buttons });
      return { messageId: mid++ };
    },
    async answerCallbackQuery() { /* noop */ },
    async editMessageText() { /* noop */ },
    async clearMessageReplyMarkup() { /* noop */ },
    captureNextText(_chatId: number, _threadId: number | undefined, resolver: (t: string | null) => void) {
      textResolver = resolver;
      return () => { textResolver = null; };
    },
  };
  return {
    bot,
    sent,
    fire: (data: string) => cb!({ id: 'c', userId: 1, data } as TgCallbackQuery),
    fireText: (t: string | null) => { const r = textResolver!; textResolver = null; return r(t); },
    hasTextCapture: () => textResolver !== null,
    // Parse the session id from the most recent question message's first button.
    sid: (msgIdx = 0) => sent[msgIdx]!.buttons[0]![0]!.data.split(':')[1]!,
    // All button datas of the message at msgIdx, flattened.
    datas: (msgIdx: number) => sent[msgIdx]!.buttons.flat().map((b) => b.data),
  };
}

function q(over: Partial<AskUserQuestionRequest['questions'][number]> = {}): AskUserQuestionRequest['questions'][number] {
  return {
    id: 'color',
    header: 'Color',
    question: 'Pick a color',
    options: [
      { label: 'Red', description: 'warm' },
      { label: 'Green', description: 'calm' },
      { label: 'Blue', description: 'cool' },
    ],
    ...over,
  };
}

describe('telegram QuestionChannel', () => {
  test('single-select resolves the tapped option label', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    const answer = ch.ask({ questions: [q({ includeOther: false })] });
    await flush();
    expect(fake.sent).toHaveLength(1);
    const sid = fake.sid();
    // buttons: Red/Green/Blue (no Other since includeOther:false)
    expect(fake.datas(0)).toEqual([`mq:${sid}:0:0`, `mq:${sid}:0:1`, `mq:${sid}:0:2`]);

    await fake.fire(`mq:${sid}:0:1`); // tap Green
    expect(await answer).toEqual({ answers: { color: 'Green' } });
  });

  test('multiSelect collects toggled labels on Done', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    const answer = ch.ask({ questions: [q({ multiSelect: true, includeOther: false })] });
    await flush();
    const sid = fake.sid();
    // includes a Done button
    expect(fake.datas(0)).toContain(`mq:${sid}:0:done`);

    await fake.fire(`mq:${sid}:0:0`); // Red on
    await fake.fire(`mq:${sid}:0:2`); // Blue on
    await fake.fire(`mq:${sid}:0:0`); // Red off (toggle)
    await fake.fire(`mq:${sid}:0:done`);
    expect(await answer).toEqual({ answers: { color: ['Blue'] } });
  });

  test('Other captures the next text message', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    const answer = ch.ask({ questions: [q({ includeOther: true })] });
    await flush();
    const sid = fake.sid();
    expect(fake.datas(0)).toContain(`mq:${sid}:0:other`);

    await fake.fire(`mq:${sid}:0:other`);
    expect(fake.hasTextCapture()).toBe(true);
    fake.fireText('Teal');
    expect(await answer).toEqual({ answers: { color: 'Other' }, otherText: { color: 'Teal' } });
  });

  test('walks multiple questions in order', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    const answer = ch.ask({
      questions: [
        q({ id: 'a', includeOther: false }),
        q({ id: 'b', includeOther: false, options: [{ label: 'X', description: '' }, { label: 'Y', description: '' }] }),
      ],
    });
    await flush();
    const sid1 = fake.sid(0);
    await fake.fire(`mq:${sid1}:0:2`); // Q1 → Blue
    await flush();
    // Q2 posted as a new message
    expect(fake.sent.length).toBe(2);
    const sid2 = fake.sid(1);
    await fake.fire(`mq:${sid2}:1:1`); // Q2 → Y
    expect(await answer).toEqual({ answers: { a: 'Blue', b: 'Y' } });
  });

  test('cancel() resolves null', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    const answer = ch.ask({ questions: [q()] });
    await flush();
    ch.cancel();
    expect(await answer).toBeNull();
  });

  test('empty question set → null (dropped from race)', async () => {
    const fake = makeFakeBot();
    const ch = createTelegramSurfaceHitl(fake.bot as never).questionChannelForChat(7);
    expect(await ch.ask({ questions: [] })).toBeNull();
  });
});
