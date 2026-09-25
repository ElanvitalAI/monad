/**
 * space-ladder.test.ts — ⛔ 이 자의 위험한 축 셋:
 *    ⓐ 눈금이 «없을» 때 만점을 주는 것
 *    ⓑ `calc(var(--u) * N)` 을 «못 펴서» 눈금을 0칸으로 보는 것(자작 절반이 그 꼴이다)
 *    ⓒ 분모가 «둘»일 때 ✅ 를 성과로 내는 것
 */
import { describe, expect, test } from 'bun:test';
import {
  expandLadder, judgeSpaceLadder, renderSpaceLadder,
  DISCRIMINATING_STEP_COUNT, SPACE_LADDER_BLIND_SPOTS,
} from './space-ladder.js';

describe('expandLadder — `calc(var(--u) * N)` 을 «편다»', () => {
  test('🩸⭐ 뿌리가 px 면 배수를 펴서 눈금을 만든다', () => {
    expect(expandLadder({ '--u': '8px', '--s1': 'calc(var(--u) * 1)', '--s3': 'calc(var(--u) * 3)' }))
      .toEqual([8, 24]);
  });

  test('곱셈 «공백 없음»도 문다', () => {
    expect(expandLadder({ '--u': '4px', '--s2': 'calc(var(--u)*2)' })).toEqual([4, 8]);
  });

  test('⛔ 뿌리가 «폭에 따라 변하면» 펴지 «않는다» — 지어내지 않는다', () => {
    expect(expandLadder({ '--u': 'clamp(7px, 0.7vw, 9px)', '--s2': 'calc(var(--u) * 2)' })).toEqual([]);
  });

  test('⛔ 나눗셈·덧셈은 안 편다(모호하다)', () => {
    expect(expandLadder({ '--u': '8px', '--x': 'calc(var(--u) / 2)', '--y': 'calc(var(--u) + 2px)' }))
      .toEqual([8]);
  });

  test('직접 px 선언은 그대로 담는다', () => {
    expect(expandLadder({ '--space-1': '10px', '--space-2': '20px' })).toEqual([10, 20]);
  });
});

describe('judgeSpaceLadder', () => {
  const painted = [{ px: 10, count: 12 }, { px: 20, count: 5 }, { px: 30, count: 2 }, { px: 14, count: 3 }];

  test('⛔⭐ 눈금이 «비면» null — 「이탈 0」이 아니다', () => {
    expect(judgeSpaceLadder(painted, [])).toBeNull();
  });

  test('⛔ 띄운 간격이 «비어도» null', () => {
    expect(judgeSpaceLadder([], [10, 20])).toBeNull();
  });

  test('눈금 밖을 «값»으로 낸다', () => {
    const r = judgeSpaceLadder(painted, [10, 20, 30, 40])!;
    expect(r.offLadder.map((u) => u.px)).toEqual([14]);
    expect(r.offLadderHits).toBe(3);
    expect(r.unusedSteps).toEqual([40]);
    expect(r.discriminating).toBe(true);
  });

  test('⭐ 이탈은 «자주 쓰인 것»부터', () => {
    const r = judgeSpaceLadder([{ px: 7, count: 1 }, { px: 13, count: 9 }, { px: 10, count: 1 }], [10])!;
    expect(r.offLadder.map((u) => u.px)).toEqual([13, 7]);
  });

  test('⛔⭐ 띄운 간격이 셋 미만이면 «변별하지 않는다»', () => {
    const r = judgeSpaceLadder([{ px: 10, count: 5 }, { px: 20, count: 1 }], [10, 20])!;
    expect(r.discriminating).toBe(false);
    expect(DISCRIMINATING_STEP_COUNT).toBe(3);
  });

  // ⛔⭐⭐ ⚪D(2026-09-12 🅕) — ***`0` 은 «칸이 아니다», 그리고 그 «버림»이 보여야 한다.***
  test('⛔⭐ 선언한 «0» 은 칸으로 «안» 세되 버린 수를 «낸다»', () => {
    const r = judgeSpaceLadder(painted, [0, 10, 20, 30])!;
    // 판정은 안 바뀐다 — 0 은 눈금에 «없다»
    expect(r.declared).toBe(3);
    // ⛔ 그런데 「버렸다」가 «값»으로 남는다
    expect(r.zeroRungsDropped).toBe(1);
  });

  test('⛔⭐ 띄운 «0» 도 분모에서 빼되 버린 수를 «낸다»', () => {
    const r = judgeSpaceLadder([...painted, { px: 0, count: 40 }], [10, 20, 30])!;
    // 분모(used)는 0 을 «안» 센다 — 40회나 띄웠어도
    expect(r.used).toBe(painted.length);
    expect(r.zeroStepsDropped).toBe(1);
  });

  test('⛔ 0 이 «없으면» 버린 수도 0 — 「안 봤다」와 「없다」를 가른다', () => {
    const r = judgeSpaceLadder(painted, [10, 20, 30])!;
    expect(r.zeroRungsDropped).toBe(0);
    expect(r.zeroStepsDropped).toBe(0);
  });
});

describe('renderSpaceLadder', () => {
  test('⛔ 「못 쟀음」을 «0» 으로 쓰지 않는다', () => {
    expect(renderSpaceLadder(null)).toContain('못 쟀다');
    expect(renderSpaceLadder(null)).not.toContain('✅');
  });

  test('⛔ 분모가 모자라면 «수»보다 「변별 안 함」을 먼저 말한다', () => {
    const line = renderSpaceLadder(judgeSpaceLadder([{ px: 10, count: 5 }, { px: 20, count: 1 }], [10, 20]));
    expect(line).toContain('변별하지 않는다');
    expect(line).not.toContain('✅');
  });

  // ⛔⭐⭐ ⚪D — ***버린 `0` 을 «말하지 않으면» 선언한 사람이 조용히 틀린다.***
  test('⛔⭐ 버린 «0» 이 «제 줄»로 나온다 — 「눈금 안이다」로 읽히지 않게', () => {
    const line = renderSpaceLadder(judgeSpaceLadder(
      [{ px: 10, count: 1 }, { px: 20, count: 1 }, { px: 30, count: 1 }, { px: 0, count: 9 }],
      [0, 10, 20, 30]));
    expect(line).toContain('버린 «0»');
    expect(line).toContain('선언 눈금 1칸');
    expect(line).toContain('띄운 간격 1종');
    // ⛔ 판정 줄과 «섞이면» 통과의 옷을 입는다 — 제 줄이어야 한다
    expect(line.split('\n').length).toBeGreaterThan(1);
  });

  test('⛔ 0 이 없으면 그 줄은 «안» 뜬다 — 늘 뜨는 줄은 아무것도 안 가른다', () => {
    const line = renderSpaceLadder(judgeSpaceLadder(
      [{ px: 10, count: 1 }, { px: 20, count: 1 }, { px: 30, count: 1 }], [10, 20, 30]));
    expect(line).not.toContain('버린 «0»');
  });

  test('이탈 값이 문면에 나온다', () => {
    const line = renderSpaceLadder(judgeSpaceLadder(
      [{ px: 10, count: 1 }, { px: 20, count: 1 }, { px: 14, count: 3 }], [10, 20]));
    expect(line).toContain('14px×3');
  });
});

describe('사각', () => {
  test('스스로 «못 보는 것»을 값으로 낸다 — 「파생값」이 첫 줄 가까이 있다', () => {
    expect(SPACE_LADDER_BLIND_SPOTS.length).toBeGreaterThan(4);
    expect(SPACE_LADDER_BLIND_SPOTS.join(' ')).toContain('derived-values');
    expect(SPACE_LADDER_BLIND_SPOTS.join(' ')).toContain('needs-three-steps');
  });
});
