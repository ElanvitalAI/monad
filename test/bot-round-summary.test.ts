/**
 * 📈 봇 «회차 산출» 요약 — 순수 층 시험 (🅕 45차)
 * ⛔ 파일·데몬·VM 을 «안» 건드린다. 그래서 어디서든 돈다.
 */
import { describe, expect, test } from 'bun:test';
import { describeStepDrift, summarizeBotRound } from '../src/bots/round-summary.js';

/** 📏 실물 `RESULT.json`(2026-09-01 investor 회차)에서 «모양만» 옮겼다. */
const REAL = {
  personaId: 'investor', steps: 4, failed: 0, ok: true, source: 'cron',
  runId: 'botlab-investor-2026-09-01T22-40-01-741Z', stateRoot: '/Users/x/.elanous',
  finishedAtUtc: '2026-09-01T22:40:19.940Z',
  tree: { cwd: '/x', head: '142505185', behindMain: 0 },
  results: [
    { label: 'KR 수급 · 삼성전자', ok: true, ms: 855, chars: 683 },
    { label: '삼성전자 «차트»', ok: true, ms: 10275, chars: 297 },
    { label: 'KR 시장 흐름', ok: true, ms: 551, chars: 1066 },
    { label: '미국 지수 · S&P500', ok: true, ms: 344, chars: 567 },
  ],
  delivery: { mode: 'send', bytes: 3778, sent: true, photosSent: 1, photoMode: true },
};

describe('📈 회차 요약 — ⛔ 새 데이터를 «안» 만든다', () => {
  test('① 실물 모양을 읽는다', () => {
    const s = summarizeBotRound(REAL);
    expect(s.personaId).toBe('investor');
    expect(s.ok).toBe(true);
    expect(s.source).toBe('cron');          // ⇐ 「무인이었다」
    expect(s.delivered).toBe(true);          // ⇐ 「사람에게 닿았다」
    expect(s.items.length).toBe(4);
    expect(s.unreadable).toEqual([]);
  });

  test('② ⛔⭐ 그림 경로를 «한 개도» 안 낸다 — 대표가 차트를 뺐다(#15326)', () => {
    const s = summarizeBotRound(REAL);
    const blob = JSON.stringify(s);
    // 🔑 「글만 보인다」가 그 지시의 «뜻»이다. 요약이 png 를 나르면 카드가 그것을 되살린다.
    for (const leak of ['.png', 'chart-005930', 'photosSent', 'photoMode']) {
      expect(blob).not.toContain(leak);
    }
    // ⚠️ 단 「차트 «걸음»이 있었다」는 사실은 지운다고 없어지지 않는다 — 그것은 «그 회차의 진실»이다.
    expect(blob).toContain('차트');
  });

  test('③ ⛔ 「돌았다」와 「성공했다」가 갈린다', () => {
    const s = summarizeBotRound({ ...REAL, ok: false, failed: 2 });
    expect(s.ok).toBe(false);
    expect(s.failed).toBe(2);
    expect(s.items.length).toBe(4);          // 걸음은 그대로 있다
  });

  test('④ ⛔ 「손」으로 «가정하지 않는다» — source 가 없으면 unknown', () => {
    const { source: _drop, ...noSource } = REAL;
    expect(summarizeBotRound(noSource).source).toBe('unknown');
  });

  test('⑤ ⛔ 모양이 달라도 «안 터진다» — 못 읽은 칸을 «이름으로» 남긴다', () => {
    const s = summarizeBotRound({ personaId: 'investor' });
    expect(s.personaId).toBe('investor');
    expect(s.unreadable).toContain('finishedAtUtc');
    expect(s.unreadable).toContain('results');
    expect(s.unreadable).toContain('delivery.sent');
    // 🔑 그래야 「카드가 비었다」와 「회차가 비었다」가 갈린다.
  });

  test('⑥ ⛔ RESULT.json 자체를 못 읽어도 «이름을 대고» 낸다', () => {
    for (const bad of [null, undefined, 'text', 42, []]) {
      const s = summarizeBotRound(bad, 'investor');
      expect(s.personaId).toBe('investor');
      expect(s.unreadable.length).toBeGreaterThan(0);
      expect(s.items).toEqual([]);
    }
  });

  test('⑦ ⛔ 잘못된 칸 하나가 «나머지를 안 죽인다»', () => {
    const s = summarizeBotRound({ ...REAL, results: [REAL.results[0], null, { ok: true }, REAL.results[3]] });
    expect(s.items.length).toBe(2);                       // 읽을 수 있는 둘은 살았다
    expect(s.unreadable).toContain('results[] 한 칸');
    expect(s.unreadable).toContain('results[].label');
  });
});

describe('📈⭐ 걸음 수 어긋남 — 「고장」이 아니라 「코드가 더 새것이다」', () => {
  test('⑧ 🩸 실물: 대표가 차트를 뺀 뒤 옛 회차가 4걸음(선언 3)이었다', () => {
    const s = summarizeBotRound(REAL);
    const drift = describeStepDrift(s, 3);
    expect(drift).not.toBeNull();
    expect(drift).toContain('옛 코드');
    // 🔑 이 문장이 없으면 다음 창이 그 어긋남을 «결손»으로 읽고 하루를 쓴다.
  });

  test('⑨ 반대 방향도 «다른 문장»으로 — 걸음이 늘고 아직 안 돈 회차', () => {
    const drift = describeStepDrift(summarizeBotRound(REAL), 6);
    expect(drift).toContain('늘어난');
  });

  test('⑩ ⛔ 못 재면 «아무 말도 안 한다» — 지어내지 않는다', () => {
    expect(describeStepDrift(summarizeBotRound(REAL), null)).toBeNull();
    expect(describeStepDrift(summarizeBotRound({ personaId: 'x' }), 3)).toBeNull();
    expect(describeStepDrift(summarizeBotRound(REAL), 4)).toBeNull();   // 같으면 조용하다
  });
});
