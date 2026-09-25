import { describe, expect, spyOn, test } from 'bun:test';
import { TelegramBot } from '../src/telegram.js';
import { defaultTelegramCommands } from '../src/telegram-commands.js';
import * as personaRegistry from '../src/persona/global-registry.js';

/**
 * 🚨⭐⭐⭐ **「코드가 도나」와 「도는 데몬이 그 코드인가」는 다른 값이다** (2026-09-01 · 42차)
 *
 * 🩸 계기 — `/chart` 가 폰에서 «무응답»이었다(2회 · `/ping` 은 4초에 답함).
 *    45분을 좁혔는데 ***`matchChartIntent`·명령 목록·핸들러·배선이 «전부 초록»***이었다.
 *    ⇒ 마지막에 이 시험이 하는 것과 «같은 것»을 손으로 해 보니 ***3ms 에 완벽히 답했다***.
 * 🔑 ⇒ 그래서 판정이 갈렸다: ***코드가 아니라 「도는 데몬」이 다르다.***
 *
 * ⚠️ **이 시험이 «못» 답하는 것**: 「도는 데몬이 이 코드인가」.
 *    그건 원리상 in-process 로 불가능하다 — 실물 주입(`scripts/telegram-inject.ts`)의 몫이다.
 * ⭐ **이 시험이 답하는 것**: ***「이 입력이 이 표면을 지나 «사람 말»로 나오나」.***
 *    ⛔ 순수 함수 시험은 그것을 못 답한다 — 표면(디스패치)이 중간에 있기 때문이다.
 */
const CFG = { telegram: { botToken: 'test:token', allowedUsers: [4242] } } as never;

/** 📮 네트워크를 안 탄다 — 「무엇을 보내려 했나」만 모은다. */
function makeBot(
  slashCommands = defaultTelegramCommands(),
): { bot: any; sent: { method: string; text?: string }[]; llmHits: () => number } {
  const sent: { method: string; text?: string }[] = [];
  let llm = 0;
  const bot: any = new TelegramBot({
    token: 'test:token',
    allowedUsers: [4242],
    onMessage: async () => { llm += 1; return 'llm 이 답했다'; },
    fetchImpl: (async (url: unknown, init?: { body?: string }) => {
      let body: { text?: string } = {};
      try { body = JSON.parse(init?.body ?? '{}') as { text?: string }; } catch { /* 형식이 아니면 비운다 */ }
      sent.push({ method: String(url).split('/').pop() ?? '?', ...(body.text ? { text: body.text } : {}) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }) as never,
    log: () => {},
    slashCommands,
    slashContext: { userConfig: CFG },
  });
  return { bot, sent, llmHits: () => llm };
}

const incoming = (text: string) => ({ chatId: 4242, userId: 4242, messageId: 1, text, attachments: [] });

function registryFreeCommands() {
  return defaultTelegramCommands().map((command) =>
    command.name === 'bots' || command.name === 'routines'
      ? { ...command, handler: async () => `routed /${command.name}` }
      : command,
  );
}

describe('📈⭐⭐ `/chart` 가 «표면을 지나» 사람 말로 나온다', () => {
  test('🔑 슬래시가 «디스패치»된다 — LLM 으로 흐르지 «않는다»', async () => {
    const { bot, sent, llmHits } = makeBot();
    await bot.handleIncoming(incoming('/chart'));
    expect(llmHits()).toBe(0);                       // ⛔ 이것이 0 이 아니면 슬래시가 «안 잡힌» 것이다
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('sendMessage');
    expect(sent[0]!.text).toContain('티커가 없습니다');
  });

  test('⛔ 답이 «비지 않는다» — 빈 답은 사람에게 「무응답」으로 보인다', async () => {
    const { bot, sent } = makeBot();
    await bot.handleIncoming(incoming('/chart'));
    expect((sent[0]!.text ?? '').length).toBeGreaterThan(0);
  });

  test('⭐ 명령 목록에 chart 가 «있다» — 등록 목록과 처리 목록은 같은 출처여야 한다', () => {
    const names = defaultTelegramCommands().map((c) => c.name);
    expect(names).toContain('chart');
    // ⛔ 이름 중복이 있으면 텔레그램이 «덜» 저장한다 — 42차가 그것을 의심해 쟀다.
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('🗣️ 자연어 → 슬래시 라우팅이 «표면에서» 산다', () => {
  test('🔑⭐ 「AAPL 차트 보여줘」가 LLM 이 아니라 «차트 경로»로 간다', async () => {
    const { bot, sent, llmHits } = makeBot();
    await bot.handleIncoming(incoming('AAPL 차트 보여줘'));
    // ⛔ LLM 이 답하면 ***가짜 표***가 온다 — 42차가 폰에서 실제로 그것을 받았다
    //    (「2026.03 167,200원 ▁」 같은 «지어낸» 표).
    expect(llmHits()).toBe(0);
    expect(sent.length).toBeGreaterThan(0);
  });

  test('⛔ 차트와 «상관없는» 글은 그대로 LLM 으로 흐른다 — 라우팅이 «과잉»이면 안 된다', async () => {
    const { bot, llmHits } = makeBot();
    await bot.handleIncoming(incoming('오늘 날씨 어때'));
    expect(llmHits()).toBe(1);
  });

  test('「봇 목록 보여줘」는 명부 없이 /bots 로 디스패치된다', async () => {
    const load = spyOn(personaRegistry, 'awaitGlobalPersonaLoad');
    const { bot, sent, llmHits } = makeBot(registryFreeCommands());
    await bot.handleIncoming(incoming('봇 목록 보여줘'));
    expect(llmHits()).toBe(0);
    expect(load).not.toHaveBeenCalled();
    expect(sent[0]!.text).toBe('routed /bots');
    load.mockRestore();
  });

  test.each([
    ['봇 목록 상태', '/bots'],
    ['봇 목록 화면', '/bots'],
    ['루틴 상태', '/routines'],
  ])('목록 의도와 명부 낱말이 겹쳐도 %s 는 명부 없이 %s 로 디스패치된다', async (text, route) => {
    const load = spyOn(personaRegistry, 'awaitGlobalPersonaLoad');
    const { bot, sent, llmHits } = makeBot(registryFreeCommands());
    await bot.handleIncoming(incoming(text));
    expect(llmHits()).toBe(0);
    expect(load).not.toHaveBeenCalled();
    expect(sent[0]!.text).toBe(`routed ${route}`);
    load.mockRestore();
  });

  test('「루틴 뭐 있어」는 명부 없이 /routines 로 디스패치된다', async () => {
    const load = spyOn(personaRegistry, 'awaitGlobalPersonaLoad');
    const { bot, sent, llmHits } = makeBot(registryFreeCommands());
    await bot.handleIncoming(incoming('루틴 뭐 있어'));
    expect(llmHits()).toBe(0);
    expect(load).not.toHaveBeenCalled();
    expect(sent[0]!.text).toBe('routed /routines');
    load.mockRestore();
  });
});
