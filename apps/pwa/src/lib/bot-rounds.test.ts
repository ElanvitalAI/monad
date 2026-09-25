/**
 * 📈 `bot-rounds` 반증 — ⛔ ***라우트가 없는 채로*** 화면 층을 세운다(대표 ⓐ 안).
 * 🔑 그래서 이 시험이 「라우트가 서기 «전»에 화면이 옳은가」의 «유일한» 자다.
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toRoundView, toRoundsState, formatWhen, fmtNum } from './bot-rounds';

const FX = join(import.meta.dir, '..', '..', '..', '..', 'test', 'fixtures', 'botlab');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');

describe('toRoundView — 실물 산출로', () => {
  const v = toRoundView({
    personaId: 'investor', runId: 'botlab-investor-X', atUtc: '2026-09-02T22:40:06.913Z',
    ok: true, steps: 3, failed: 0, source: 'cron',
    delivery: { sent: true, photosSent: 0, chars: 2674 },
    artifacts: [
      { name: '미국-지수-S-P500.txt', text: fx('investor-미국-지수-S-P500.txt') },
      { name: 'KR-수급-삼성전자.txt', text: fx('investor-KR-수급-삼성전자.txt') },
    ],
  });
  test('메타를 그대로 옮긴다', () => {
    expect(v.personaId).toBe('investor');
    expect(v.source).toBe('cron');        // ⭐ 「무인」임을 화면이 말할 수 있다
    expect(v.delivered).toBe(true);
  });
  test('산출을 «판정해» 담는다', () => {
    expect(v.artifacts.map((a) => a.kind)).toEqual(['quote', 'flow']);
  });
  test('📰 실제 newsbot Omni 산출은 readArtifact를 거쳐 news 뷰 모델로 간다', () => {
    const news = toRoundView({
      personaId: 'newsbot',
      artifacts: [{ name: 'AI-소식-뉴스-.txt', text: fx('newsbot-AI-소식-뉴스-.txt') }],
    });
    expect(news.artifacts).toHaveLength(1);
    expect(news.artifacts[0]?.kind).toBe('news');
    if (news.artifacts[0]?.kind === 'news') {
      expect(news.artifacts[0].news.items).toHaveLength(5);
      expect(news.artifacts[0].news.items[0]?.date).toBe('4 days ago');
    }
  });
  test('⛔ 본문이 «안 온» 산출은 버리지 않고 textless 로 남는다', () => {
    const w = toRoundView({ artifacts: [{ name: 'a.txt' }, { name: 'b.txt', text: '대상: X' }] });
    expect(w.textless).toEqual(['a.txt']);   // 🔑 빈 카드와 「본문을 안 받았다」가 갈린다
  });
  test('⛔ 모양이 «비어도» 안 터진다', () => {
    const w = toRoundView({});
    expect(w.personaId).toBe('unknown');
    expect(w.source).toBe('unknown');        // ⛔ 「손」으로 가정하지 않는다
    expect(w.ok).toBeNull();                 // ⛔ false 가 아니다
  });
});

describe('toRoundsState — ⛔ 「0건」과 「못 받았다」를 가른다', () => {
  test('빈 배열은 «ready 0건»이다 — 오류가 아니다', () => {
    const st = toRoundsState({ rounds: [] });
    expect(st.kind).toBe('ready');
    if (st.kind === 'ready') expect(st.rounds.length).toBe(0);
  });
  test('⛔ rounds 가 배열이 «아니면» 오류다 — 0건으로 접지 않는다', () => {
    expect(toRoundsState({ rounds: null }).kind).toBe('error');
    expect(toRoundsState({}).kind).toBe('error');
    expect(toRoundsState('nope').kind).toBe('error');
  });
  test('라우트가 낸 unreadable 을 «그대로» 들고 간다', () => {
    const st = toRoundsState({ rounds: [], unreadable: 3 });
    if (st.kind === 'ready') expect(st.unreadable).toBe(3);
  });

  test('⭐ 「옛 회차(result-missing)」는 «지금 깨진 것»이 아니다', () => {
    const st = toRoundsState({ rounds: [], unreadable: 45, unreadableBy: { 'result-missing': 45, 'result-broken': 0 } });
    if (st.kind !== 'ready') throw new Error('ready 가 아니다');
    expect(st.unreadable).toBe(45);
    expect(st.unreadableNow).toBe(0);      // 🔑 경보를 «안» 올린다
  });

  test('⚠️ 「지금 깨진 것」은 골라 센다', () => {
    const st = toRoundsState({ rounds: [], unreadable: 47, unreadableBy: { 'result-missing': 45, 'result-broken': 1, rejected: 1 } });
    if (st.kind !== 'ready') throw new Error('ready 가 아니다');
    expect(st.unreadableNow).toBe(2);
  });

  test('⛔ 까닭을 «안 받았으면» 전부를 「지금」으로 본다 — 조용한 초록보다 시끄러운 게 낫다', () => {
    const st = toRoundsState({ rounds: [], unreadable: 9 });
    if (st.kind !== 'ready') throw new Error('ready 가 아니다');
    expect(st.unreadableNow).toBe(9);
  });
});

describe('formatWhen — ⛔ 시간대를 «말한다»', () => {
  test('UTC 를 KST 로 바꾸고 «그렇게 적는다»', () => {
    // 2026-09-02T22:40Z = 09-03 07:40 KST  ⭐ 이 창이 UTC/KST 로 두 번 틀렸다
    const s = formatWhen('2026-09-02T22:40:06.913Z');
    expect(s).toContain('KST');
    expect(s).toContain('09');
    expect(s).toContain('07:40');
  });
  test('⛔ 모르면 «모른다»고 한다 — 지금 시각을 지어내지 않는다', () => {
    expect(formatWhen(null)).toContain('모름');
    expect(formatWhen('쓰레기')).toContain('못 읽었다');
  });
});

describe('fmtNum — ⛔ null 은 0 이 «아니다»', () => {
  test('null 은 대시', () => { expect(fmtNum(null)).toBe('—'); });
  test('⭐ 진짜 0 은 0 으로 보인다', () => { expect(fmtNum(0)).toBe('0'); });
  test('천 단위·부호', () => {
    expect(fmtNum(-2576734)).toBe('-2,576,734');
    expect(fmtNum(35.13, { sign: true })).toBe('+35.13');
  });
});
