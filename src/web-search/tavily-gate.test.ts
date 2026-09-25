// tavily 상시사용 게이트 회귀 (대표 2026-08-06).
//
// ⛔⭐ **왜 이 파일이 있나** — 종전엔 tavily 가 «항상» 1순위로 등록됐고, 그래서 크론 디깅·deep
//    리서치가 돌 때마다 유료 검색이 고정비로 붙었다. 스위치를 넣었으니 그 스위치가
//    ***실제로 판정을 가르는지***를 잠근다. 스위치는 있는데 아무 데도 안 물리는 것이
//    이 저장소가 여러 번 밟은 형태다(「배선 결손」).
//
// ⚠️ 등록 자체(`registerBuiltins`)는 **모듈 로드 시점**이라 여기서 못 흔든다 — 그래서
//    판정을 순수 함수로 빼 두었고, 이 파일은 **그 함수와 파서**를 잠근다.
import { describe, test, expect } from 'bun:test';
import { isTavilySearchEnabled, type UserConfig } from '../user-config.js';
import { pickSearchPlan } from '../domains/dig-engine.js';

const cfg = (webSearch: UserConfig['webSearch']): Pick<UserConfig, 'webSearch'> => ({ webSearch });

describe('tavily 상시사용 게이트', () => {
  test('⛔ 미설정이면 «꺼짐» — 부재를 「켜짐」으로 읽지 않는다', () => {
    expect(isTavilySearchEnabled(cfg(undefined))).toBe(false);
    expect(isTavilySearchEnabled(cfg({}))).toBe(false);
    expect(isTavilySearchEnabled(cfg({ tavily: {} }))).toBe(false);
  });

  test('명시 false 는 꺼짐 · 명시 true 만 켜짐', () => {
    expect(isTavilySearchEnabled(cfg({ tavily: { enabled: false } }))).toBe(false);
    expect(isTavilySearchEnabled(cfg({ tavily: { enabled: true } }))).toBe(true);
  });

  // ⭐ 스위치가 «실제 라우팅»을 가르는지 — 게이트가 값만 바꾸고 아무것도 안 바꾸면 의미가 없다.
  test('디깅 검색 계획이 주입된 엔진 이름을 그대로 탄다', () => {
    const item = { id: 'signal:1', topic: 't', sector: 'other', score: 8 };
    expect(pickSearchPlan(item, 'ddg').engine).toBe('ddg');
    expect(pickSearchPlan(item, 'tavily').engine).toBe('tavily');
    // 기본 인자 = 무료. ⛔ 호출부가 config 를 안 읽어도 «유료로» 새지 않는다.
    expect(pickSearchPlan(item).engine).toBe('ddg');
  });

  test('종목 디깅도 같은 스위치를 따른다(firecrawl 병행은 유지)', () => {
    const stock = { id: 'pulse:US:NVDA:2026-08-06', topic: 't', sector: 'NVDA', score: 8 };
    expect(pickSearchPlan(stock, 'ddg').engine).toBe('ddg,firecrawl');
    expect(pickSearchPlan(stock, 'tavily').engine).toBe('tavily,firecrawl');
  });
});
