// Tier0 정규화 단위테스트 — 실제 fmkorea 제목(라이브 관측) + WSB 은어.
import { describe, test, expect } from 'bun:test';
import { normalizeText } from './normalize.js';
import { SLANG_SEED, openSlangDict, loadSlangEntries } from './slang-dict.js';

const D = SLANG_SEED;

describe('normalizeText — 한국 은어(라이브 fmkorea 제목)', () => {
  test('"전원주 하닉 평단 2.9만" → 하닉=티커·평단=entity', () => {
    const r = normalizeText('전원주 하닉 평단 2.9만 <<<< 이건 요즘생각해도 벽느껴짐', D);
    expect(r.tickers).toContain('000660.KO');   // 하닉 → SK하이닉스
    expect(r.entities).toContain('평균단가');    // 평단
  });

  test('"실시간 야선 +5.55 외궈 기관 매수중" → 야간선물·외국인·기관', () => {
    const r = normalizeText('실시간 야선 +5.55 외궈 기관 매수중', D);
    expect(r.entities).toEqual(expect.arrayContaining(['야간선물', '외국인', '기관']));
  });

  test('"실시간 마이크론 대폭발" → 마이크론=MU', () => {
    const r = normalizeText('실시간 마이크론 대폭발 발기 ㄷㄷㄷ', D);
    expect(r.tickers).toContain('MU');
  });

  test('긍부정 은어 polarity — 떡상=강긍정·줄빠따=부정', () => {
    expect(normalizeText('삼전 떡상 가즈아', D).polarity!).toBeGreaterThan(0.5);
    expect(normalizeText('빅테크 왜 줄빠따?', D).polarity!).toBeLessThan(0);
  });

  test('삼전 → 삼성전자 티커', () => {
    expect(normalizeText('삼전 오늘 어떰', D).tickers).toContain('005930.KO');
  });
});

describe('normalizeText — 영어 WSB 은어', () => {
  test('cashtag $GME + tendies(긍정) + diamond hands', () => {
    const r = normalizeText('$GME to the moon, diamond hands, tendies incoming', D);
    expect(r.tickers).toContain('GME');
    expect(r.polarity!).toBeGreaterThan(0.5);
    expect(r.matched.some(m => m.term === 'diamond hands')).toBe(true);
  });

  test('cashtag 블록리스트 — $A·$IT 는 티커 제외', () => {
    const r = normalizeText('$A $IT $NVDA', D);
    expect(r.tickers).toContain('NVDA');
    expect(r.tickers).not.toContain('A');
    expect(r.tickers).not.toContain('IT');
  });

  test('단어경계 — moon 은 매칭·moonlight 는 아님', () => {
    expect(normalizeText('to the moon', D).sentiments.some(s => s.term === 'moon')).toBe(true);
    expect(normalizeText('moonlight sonata', D).sentiments.some(s => s.term === 'moon')).toBe(false);
  });
});

describe('무매칭·DB 라운드트립', () => {
  test('은어 없는 텍스트 → 빈 결과·polarity null', () => {
    const r = normalizeText('오늘 날씨 좋다', D);
    expect(r.tickers.length).toBe(0);
    expect(r.polarity).toBeNull();
  });

  test('openSlangDict 시드 → loadSlangEntries 라운드트립', () => {
    const db = openSlangDict(':memory:');
    const entries = loadSlangEntries(db);
    expect(entries.length).toBe(SLANG_SEED.length);
    // DB 로드한 사전으로도 동일 정규화
    expect(normalizeText('하닉 떡상', entries).tickers).toContain('000660.KO');
  });
});
