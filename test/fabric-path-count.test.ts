import { describe, expect, it } from 'bun:test';
import { countAskTargetPaths } from '../src/self-dev/self-orchestrate-runtime.js';

/** ⭐ 패브릭 자동 경로가 «볼 값».
 *  🩸 2026-09-08: 이 수가 `undefined` 로 «못 박혀» 있어 그 분기가 ***구조적으로 죽어*** 있었다
 *    (원장 128/128 이 `normalizedPathCount: None`).
 *  ⛔ 「못 셌다」와 「0」을 «다른 값»으로 낸다 — 0 으로 내면 임계 비교가 조용히 거짓이 된다. */
describe('ask 의 대상 경로 수', () => {
  it('한 갈래·여러 갈래를 «가운뎃점»으로 센다', () => {
    expect(countAskTargetPaths('대상 경로: src/a.ts')).toBe(1);
    expect(countAskTargetPaths('대상 경로: src/a.ts · src/b.ts · src/c.ts')).toBe(3);
  });

  it('⛔ 라벨이 «없으면» undefined — ***0 이 아니다***', () => {
    expect(countAskTargetPaths('아무 문장')).toBeUndefined();
  });

  it('⛔ 라벨은 있는데 «비었으면» undefined — 「안 셌다」로 낸다', () => {
    expect(countAskTargetPaths('대상 경로:   ')).toBeUndefined();
  });

  it('백틱·앞머리 하이픈·영문 라벨도 문다', () => {
    expect(countAskTargetPaths('- 대상 경로: `src/a.ts` · `src/b.ts`')).toBe(2);
    expect(countAskTargetPaths('target paths: src/a.ts · src/b.ts')).toBe(2);
  });

  it('⛔ 반증 — 이 자가 «항상 수»를 내지 않는다(첫 일치 줄만 본다)', () => {
    expect(countAskTargetPaths('머리말\n대상 경로: a · b\n대상 경로: c · d · e')).toBe(2);
  });
});
