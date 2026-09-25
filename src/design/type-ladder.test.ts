/**
 * type-ladder.test.ts — ⛔ ***이 자의 가장 위험한 축은 「사다리가 «없을» 때 만점을 주는 것」***이다.
 *    📏 이 창의 자작 13개가 `--font-size-*` 를 «0개» 선언하고 있었다 —
 *       그때 「이탈 0」을 내면 ***가장 나쁜 사이트가 만점을 받는다.***
 */
import { describe, expect, it } from 'bun:test';
// ⛔⭐ 🩸 이 파일은 `it(` 를 쓴다. `test(` 로 적으면 `ReferenceError` 가 ***`fail` 이 아니라 「1 error」***로 뜨고
//    ***그 안의 시험이 «한 개도 안 돈다»***(2026-09-12 에 «양방향»으로 두 번 밟았다 — 함정 ⓩⓩ4).
import {
  judgeTypeLadder, onLadder, parsePx, renderTypeLadder,
  LADDER_EPSILON_PX, DISCRIMINATING_SIZE_COUNT, TYPE_LADDER_BLIND_SPOTS,
} from './type-ladder.js';

describe('parsePx', () => {
  it('px 만 푼다', () => {
    expect(parsePx('16px')).toBe(16);
    expect(parsePx(' 15.5 px ')).toBe(15.5);
    expect(parsePx(20)).toBe(20);
  });
  it('⛔ 못 푸는 것을 0 으로 접지 않는다', () => {
    for (const v of ['1rem', '1.2em', 'inherit', '', 'px', '0px', '-4px', null, undefined]) {
      expect(parsePx(v as never)).toBeNull();
    }
  });
});

describe('onLadder', () => {
  it('반올림 찌꺼기를 삼킨다', () => {
    expect(onLadder(15.0000001, [14, 15, 17])).toBe(true);
  });
  it('⛔ 1px 칸을 «붙이지» 않는다 — starbucks 원본이 12·13·14·15·16·17 이다', () => {
    expect(LADDER_EPSILON_PX).toBeLessThan(1);
    expect(onLadder(15, [14, 16])).toBe(false);
  });
});

describe('judgeTypeLadder', () => {
  const painted = [{ px: 14, count: 12 }, { px: 15, count: 3 }, { px: 26, count: 1 }, { px: 13, count: 2 }];

  it('⛔⭐ 사다리가 «비면» null — 「이탈 0」이 아니다', () => {
    expect(judgeTypeLadder(painted, [])).toBeNull();
    expect(judgeTypeLadder(painted, [0, -4, Number.NaN])).toBeNull();
  });

  it('⛔ 칠한 크기가 «비어도» null', () => {
    expect(judgeTypeLadder([], [14, 15, 17])).toBeNull();
  });

  it('사다리 밖을 «값»으로 낸다 — 수만 내면 못 고친다', () => {
    const r = judgeTypeLadder(painted, [14, 15, 17, 20, 26]);
    expect(r).not.toBeNull();
    expect(r!.offLadder.map((u) => u.px)).toEqual([13]);
    expect(r!.offLadderHits).toBe(2);
    expect(r!.used).toBe(4);
    expect(r!.declared).toBe(5);
  });

  it('⭐ 이탈은 «자주 쓰인 것»부터 — 고칠 순서가 그 순서다', () => {
    const r = judgeTypeLadder([{ px: 9, count: 1 }, { px: 13, count: 30 }], [16]);
    expect(r!.offLadder.map((u) => u.px)).toEqual([13, 9]);
  });

  it('⭐ 「선언했는데 이 장에서 안 쓴 칸」을 «관측»으로 낸다', () => {
    const r = judgeTypeLadder(painted, [14, 15, 17, 20, 26]);
    expect(r!.unusedRungs).toEqual([17, 20]);
  });

  it('전부 사다리 안이면 이탈 0 이고 ratio 0 이다', () => {
    const r = judgeTypeLadder([{ px: 14, count: 5 }], [14, 16]);
    expect(r!.offLadder).toEqual([]);
    expect(r!.ratio).toBe(0);
  });

  it('⛔ 중복 선언·순서 뒤섞임은 사다리 칸 수를 부풀리지 않는다', () => {
    const r = judgeTypeLadder([{ px: 14, count: 1 }], [26, 14, 14, 15]);
    expect(r!.declared).toBe(3);
  });
});

describe('renderTypeLadder', () => {
  it('⛔ 「못 쟀음」을 «0» 으로 쓰지 않는다', () => {
    expect(renderTypeLadder(null)).toContain('못 쟀다');
    expect(renderTypeLadder(null)).not.toContain('✅');
  });
  it('이탈 값이 문면에 나온다', () => {
    // ⛔ 표본을 3종으로 올렸다 — 1종이면 이제 「변별 안 함」으로 간다(그것이 의도다).
    const line = renderTypeLadder(judgeTypeLadder([{ px: 13, count: 2 }, { px: 14, count: 1 }, { px: 16, count: 1 }], [14, 16]));
    expect(line).toContain('13px×2');
  });
  it('⭐ 「안 쓴 칸」은 경고가 아니라 관측 문면이다', () => {
    const line = renderTypeLadder(judgeTypeLadder(
      [{ px: 14, count: 1 }, { px: 15, count: 1 }, { px: 17, count: 1 }], [14, 15, 17, 26]));
    expect(line).toContain('✅');
    expect(line).toContain('안 쓴');
  });
});

describe('사각', () => {
  it('스스로 «못 보는 것»을 값으로 낸다', () => {
    expect(TYPE_LADDER_BLIND_SPOTS.length).toBeGreaterThan(3);
    expect(TYPE_LADDER_BLIND_SPOTS.join(' ')).toContain('declared-only');
  });
});

// ── 🩸 분모가 모자라면 ✅ 가 «성과»가 아니다 (airbnb 는 한 장에 크기 «둘»이다) ──────
describe('discriminating — 칠한 크기가 셋 미만이면 «변별하지 않는다»', () => {
  it('⛔⭐ 두 종류면 discriminating 이 false 다', () => {
    const r = judgeTypeLadder([{ px: 14, count: 9 }, { px: 28, count: 1 }], [14, 28])!;
    expect(r.used).toBe(2);
    expect(r.discriminating).toBe(false);
  });

  it('⛔ 그때 문면이 «수»보다 「변별 안 함」을 먼저 말한다', () => {
    const line = renderTypeLadder(judgeTypeLadder([{ px: 14, count: 9 }, { px: 28, count: 1 }], [14, 28]));
    expect(line).toContain('변별하지 않는다');
    expect(line).toContain('성과로 읽지 마라');
    expect(line).not.toContain('✅');
  });

  it('✅ 세 종류부터 변별한다', () => {
    const r = judgeTypeLadder([{ px: 14, count: 1 }, { px: 15, count: 1 }, { px: 26, count: 1 }], [14, 15, 26])!;
    expect(r.discriminating).toBe(true);
    expect(renderTypeLadder(r)).toContain('✅');
  });

  it('⭐ 「변별 안 함」이어도 «값은 지우지 않는다»', () => {
    const r = judgeTypeLadder([{ px: 13, count: 4 }, { px: 28, count: 1 }], [14, 28])!;
    expect(r.discriminating).toBe(false);
    expect(r.offLadder.map((u) => u.px)).toEqual([13]);   // ⛔ 값은 살아 있다
  });

  it('사각에 그 사실이 «값으로» 있다', () => {
    expect(TYPE_LADDER_BLIND_SPOTS.join(' ')).toContain('needs-three-sizes');
    expect(DISCRIMINATING_SIZE_COUNT).toBe(3);
  });
});

// ⛔⭐ 🩸 2026-09-12([S] 지적) — ***관측이 「판정 줄 «안»」에 있으면 「통과」로 읽힌다.***
//    갈린 것은 «내용」이 아니라 ***«줄을 따로 쓰나»*** 였다(같은 자·같은 화면·같은 저자).
describe('「안 쓴 칸」은 ✅ 줄 «안»에 숨지 않는다', () => {
  // ⛔ 칠한 크기가 «3종 이상»이라야 이 축이 변별한다 — 2종이면 그 앞줄에서 멎는다(첫 판에 밟았다)
  const report = judgeTypeLadder(
    [{ px: 14, count: 3 }, { px: 20, count: 2 }, { px: 26, count: 1 }],
    [14, 20, 26, 32, 38],
  )!;

  it('🩸 ✅ 줄과 ⚪ 관측이 «다른 줄»이다', () => {
    const line = renderTypeLadder(report);
    expect(line).toContain('✅');
    expect(line).toContain('안 쓴» 칸');
    const [head, ...rest] = line.split('\n');
    expect(head).toContain('✅');
    expect(head).not.toContain('안 쓴» 칸');      // ⛔ 이 단언이 이 고침의 «전부»다
    expect(rest.join('\n')).toContain('안 쓴» 칸');
  });

  it('⭐ 그 줄이 ***무엇을 하라는지***까지 담는다', () => {
    const line = renderTypeLadder(report);
    expect(line).toContain('이탈이 아니다');
    expect(line).toMatch(/다른 장|사다리를 줄여라/);
  });

  it('안 쓴 칸이 없으면 줄을 «안» 늘린다', () => {
    const tight = judgeTypeLadder(
      [{ px: 14, count: 3 }, { px: 20, count: 2 }, { px: 26, count: 1 }], [14, 20, 26])!;
    expect(renderTypeLadder(tight).split('\n')).toHaveLength(1);
  });
});
