import { describe, expect, test } from 'bun:test';

import {
  PROPORTIONAL_TOLERANCE, ratiosAgree, rangesOverlap, readSeedBreakpoint,
} from './seed-responsive.js';

describe('씨앗의 분기 «구간» 되읽기', () => {
  test('구간을 읽는다', () => {
    expect(readSeedBreakpoint('- ⭐ 분기가 **462px ↔ 468px** 사이에 있다 (구간 **6px**)'))
      .toEqual({ lowPx: 462, highPx: 468 });
  });

  test('별표가 없어도 읽는다', () => {
    expect(readSeedBreakpoint('분기가 700px ↔ 704px 사이에 있다')).toEqual({ lowPx: 700, highPx: 704 });
  });

  test('⛔ 절이 «없으면» null — 「분기가 없다」와 다른 값이다', () => {
    expect(readSeedBreakpoint('# S\n\n## Palette\n')).toBeNull();
  });

  test('⛔ 뒤집힌 구간을 «조용히 고치지» 않는다', () => {
    expect(readSeedBreakpoint('분기가 900px ↔ 400px 사이에 있다')).toBeNull();
  });
});

describe('구간은 구간과 견준다', () => {
  test('겹치면 참', () => {
    expect(rangesOverlap({ lowPx: 462, highPx: 468 }, { lowPx: 466, highPx: 480 })).toBe(true);
    // 끝이 맞닿아도 겹친 것이다
    expect(rangesOverlap({ lowPx: 462, highPx: 468 }, { lowPx: 468, highPx: 470 })).toBe(true);
  });

  test('⛔ 안 겹치면 거짓 — 다 통과시키지 않는다', () => {
    expect(rangesOverlap({ lowPx: 462, highPx: 468 }, { lowPx: 640, highPx: 648 })).toBe(false);
  });
});

describe('비례는 «값»이 아니라 «비율»로 본다', () => {
  test('허용 안이면 참', () => {
    expect(ratiosAgree(1.103, 1.11)).toBe(true);
  });

  test('⛔ 밖이면 거짓', () => {
    expect(ratiosAgree(1.103, 1.4)).toBe(false);
  });

  test('임계가 «값으로» 나가 있다 — 읽는 쪽이 다시 잴 수 있다', () => {
    expect(PROPORTIONAL_TOLERANCE).toBe(0.05);
    expect(ratiosAgree(1.0, 1.0 + PROPORTIONAL_TOLERANCE)).toBe(true);
    expect(ratiosAgree(1.0, 1.0 + PROPORTIONAL_TOLERANCE + 0.001)).toBe(false);
  });
});
