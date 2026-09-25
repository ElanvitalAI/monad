import { describe, expect, test } from 'bun:test';

import {
  judgePaintCoverage, summariseTiles, MAX_BLANK_TILE_STD_DEV, UNDER_PAINT_DROP,
  type TileCoverage,
} from './paint-coverage.js';

/** 실측 편의 — 빈 타일 `b`개 ⊕ 칠해진 타일 `p`개. */
const tiles = (b: number, p: number) => [...Array(b).fill(0), ...Array(p).fill(0.3)];
const cov = (ratio: number, total = 48): TileCoverage => ({ blank: Math.round(ratio * total), total, ratio });

describe('summariseTiles — 「빈 타일 0개」와 「못 쟀음」을 가른다', () => {
  test('실측 — spotify 미러는 48 타일 중 40 개가 빈다(0.833)', () => {
    const got = summariseTiles(tiles(40, 8));
    expect(got).not.toBeNull();
    expect(got!.blank).toBe(40);
    expect(got!.total).toBe(48);
    expect(got!.ratio).toBeCloseTo(0.833, 3);
  });

  test('⛔ 빈 목록은 «못 쟀음»(null)이다 — 0/0 을 「전부 칠했다」로 읽지 않는다', () => {
    expect(summariseTiles([])).toBeNull();
  });

  test('⛔ 유한하지 않은 값이 «하나라도» 있으면 못 쟀음이다 — 조용히 건너뛰면 분모가 몰래 줄어든다', () => {
    expect(summariseTiles([0, 0.3, Number.NaN])).toBeNull();
    expect(summariseTiles([0, -1])).toBeNull();
  });

  test('실측 문턱 — 저대비 그라디언트(sd 0.0193)는 «빈 것», 실제 내용(sd ≥ 0.06)은 아니다', () => {
    expect(MAX_BLANK_TILE_STD_DEV).toBe(0.02);
    expect(summariseTiles([0.0193])!.blank).toBe(1);
    expect(summariseTiles([0.06])!.blank).toBe(0);
  });
});

describe('judgePaintCoverage — 「미러가 원본보다 덜 칠했나」', () => {
  test('🚨 실측 spotify — 원본 0.000 → 미러 0.833 은 «덜 칠했다»', () => {
    const v = judgePaintCoverage(cov(0.0), cov(0.833));
    expect(v.verdict).toBe('mirror-under-painted');
    expect(v.drop).toBeCloseTo(0.833, 3);
    expect(v.detail).toContain('덜');
  });

  test('⭐⭐ 실측 hero-dark — ***「여백이 넓은 정상 디자인」이 원본이어도 맞는다***', () => {
    // 🩸 이 줄이 첫 처방을 «반증»한 표본이다: 절대 비율로 재면 hero-dark(0.750)가
    //    spotify 미러(0.833)와 여유 1.11배로 «안 갈린다». 대 보면 갈린다.
    const v = judgePaintCoverage(cov(0.75), cov(0.75));
    expect(v.verdict).toBe('matched');
    expect(v.drop).toBe(0);
  });

  test('⭐ 판별 사다리 ③ — 정답을 «옮겨도» 답이 그대로다', () => {
    // 사진 페이지(0.00)든 여백 디자인(0.75)든, 원본과 미러가 «같으면» 맞는다.
    for (const ratio of [0, 0.21, 0.5, 0.75, 1]) {
      expect(judgePaintCoverage(cov(ratio), cov(ratio)).verdict).toBe('matched');
    }
  });

  test('⛔ 한쪽이라도 «못 쟀으면» 「같다」가 아니다', () => {
    expect(judgePaintCoverage(null, cov(0.1)).verdict).toBe('unmeasured');
    expect(judgePaintCoverage(cov(0.1), null).verdict).toBe('unmeasured');
    expect(judgePaintCoverage(null, null).detail).toContain('둘 다');
    expect(judgePaintCoverage(null, cov(0.1)).drop).toBeNull();
  });

  test('⛔ 타일 수가 다르면 «다른 크기»를 비교한 수다 — 못 쟀음이다', () => {
    const v = judgePaintCoverage({ blank: 0, total: 48, ratio: 0 }, { blank: 40, total: 192, ratio: 0.208 });
    expect(v.verdict).toBe('unmeasured');
    expect(v.detail).toContain('타일 수가 다르다');
  });

  test('⛔ 「더 칠했다」를 «결함»으로 단정하지 않는다 — 덮개를 지우면 이렇게 된다', () => {
    const v = judgePaintCoverage(cov(0.8), cov(0.2));
    expect(v.verdict).toBe('mirror-over-painted');
    expect(v.detail).toContain('결함이 아닐 수 있다');
  });

  test('문턱 언저리 — 딱 문턱이면 잡고, 그 아래면 맞는다로 본다', () => {
    expect(judgePaintCoverage(cov(0), cov(UNDER_PAINT_DROP)).verdict).toBe('mirror-under-painted');
    expect(judgePaintCoverage(cov(0), cov(UNDER_PAINT_DROP - 0.001)).verdict).toBe('matched');
  });
});
