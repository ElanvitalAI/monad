/**
 * motion-tokens.test.ts — ⛔ 이 자의 위험한 축 셋:
 *    ⓐ ***강제 reduced-motion 의 `1e-05s` 를 「애니메이션이 없다」로 읽는 것***(nike 가 실제로 그랬다)
 *    ⓑ CSS 기본 곡선(`ease`)을 「토큰 밖」으로 세어 ***선언 안 한 자리 전부를 이탈로 만드는 것***
 *    ⓒ 쓴 곡선이 «없을» 때 만점을 주는 것
 */
import { describe, expect, test } from 'bun:test';
import {
  judgeMotionTokens, normaliseEasing, parseSeconds, renderMotionTokens,
  DEFAULT_EASINGS, MOTION_TOKEN_BLIND_SPOTS, NEAR_ZERO_SECONDS,
} from './motion-tokens.js';

const E1 = 'cubic-bezier(0.25, 0.1, 0.25, 1)';
const E2 = 'cubic-bezier(0.4, 0, 0.2, 1)';

describe('parseSeconds', () => {
  test('s·ms·지수표기를 푼다', () => {
    expect(parseSeconds('0.2s')).toBeCloseTo(0.2, 6);
    expect(parseSeconds('200ms')).toBeCloseTo(0.2, 6);
    expect(parseSeconds('1e-05s')).toBeCloseTo(0.00001, 9);
  });
  test('⛔ 못 푸는 것을 0 으로 접지 않는다', () => {
    for (const v of ['', 'fast', '0.2', 'auto']) expect(parseSeconds(v)).toBeNull();
  });
});

describe('normaliseEasing', () => {
  test('공백만 지운다 — 쉼표 뒤 공백이 있으나 없으나 «같은 값»이다', () => {
    expect(normaliseEasing('cubic-bezier(0.25, 0.1, 0.25, 1)')).toBe(normaliseEasing('cubic-bezier(0.25,0.1,0.25,1)'));
  });
});

describe('judgeMotionTokens', () => {
  test('⛔⭐ 「기본이 아닌」 곡선이 «하나도» 없으면 null — 「이탈 0」이 아니다', () => {
    expect(judgeMotionTokens([{ value: 'ease', count: 99 }], [], [E1], [], false)).toBeNull();
    expect(judgeMotionTokens([], [], [E1], [], false)).toBeNull();
  });

  test('⛔⭐ CSS 기본 곡선은 «분자에도 분모에도» 안 넣는다', () => {
    const r = judgeMotionTokens(
      [{ value: 'ease', count: 2783 }, { value: E1, count: 4 }], [], [E1], [], false)!;
    expect(r.easingsUsed).toBe(1);          // ⛔ 2783 개의 `ease` 를 «안» 센다
    expect(r.offTokenEasings).toEqual([]);
    expect(DEFAULT_EASINGS).toContain('ease');
  });

  test('토큰 밖 곡선을 «값과 횟수»로 낸다 — 자주 쓰인 것부터', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 2 }, { value: 'cubic-bezier(0.6, 0, 0.1, 1)', count: 9 }], [], [E1], [], false)!;
    expect(r.offTokenEasings.map((e) => e.count)).toEqual([9]);
  });

  test('🩸⭐⭐ 강제 reduced-motion 의 «거의 0»을 「지속 0」으로 읽지 «않는다»(nike 실측)', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 4 }], [{ value: '1e-05s', count: 2791 }], [E1], ['0.2s'], true)!;
    expect(r.durationMeasurable).toBe(false);
    expect(r.durationsUsed).toBe(0);
    expect(r.offTokenDurations).toEqual([]);   // ⛔ 「이탈 0」을 «지어내지» 않는다
    expect(NEAR_ZERO_SECONDS).toBeGreaterThan(0.00001);
  });

  test('⛔ 강제가 «없으면» 같은 값도 «잰 것»이다 — 강제 여부가 판정을 가른다', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 4 }], [{ value: '1e-05s', count: 3 }], [E1], ['0.2s'], false)!;
    expect(r.durationMeasurable).toBe(true);
    expect(r.offTokenDurations.map((d) => d.value)).toEqual(['1e-05s']);
  });

  test('토큰에 있는 지속은 이탈이 아니다(단위가 달라도)', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 4 }], [{ value: '200ms', count: 7 }], [E1], ['0.2s'], false)!;
    expect(r.offTokenDurations).toEqual([]);
  });

  test('⛔ 곡선이 셋 미만이면 «약하다»고 값으로 말한다', () => {
    const r = judgeMotionTokens([{ value: E1, count: 1 }, { value: E2, count: 1 }], [], [E1, E2], [], false)!;
    expect(r.discriminating).toBe(false);
  });
});

describe('renderMotionTokens', () => {
  test('⛔ 「못 쟀음」을 «0» 으로 쓰지 않는다', () => {
    expect(renderMotionTokens(null)).toContain('못 쟀다');
    expect(renderMotionTokens(null)).not.toContain('✅');
  });

  test('🩸 강제 reduced-motion 이면 지속 칸이 «⚪» 로 나온다', () => {
    const line = renderMotionTokens(judgeMotionTokens(
      [{ value: E1, count: 4 }], [{ value: '1e-05s', count: 2791 }], [E1], ['0.2s'], true));
    expect(line).toContain('지속시간은 «못 쟀다»');
    expect(line).toContain('reduced-motion');
  });

  test('사각에 그 사실이 «첫 줄»로 있다', () => {
    expect(MOTION_TOKEN_BLIND_SPOTS[0]).toContain('reduced-motion-forced');
    expect(MOTION_TOKEN_BLIND_SPOTS.join(' ')).toContain('ease-is-default');
  });
});

// ── 🩸 실물에서 잡은 것 — ***분모가 0인데 이탈을 냈다*** ────────────────────────
describe('지속 토큰이 «없을» 때', () => {
  test('⛔⭐ 선언이 하나도 «없으면» 그 축은 «안 잰다» — 「이탈 N」을 내지 않는다', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 15 }], [{ value: '0.2s', count: 21 }], [E1], [], false)!;
    expect(r.durationMeasurable).toBe(false);
    expect(r.offTokenDurations).toEqual([]);   // ⛔ 예전엔 여기서 «1종 이탈»을 냈다
    expect(r.durationsUsed).toBe(0);
  });

  test('⭐ 선언이 «하나라도» 있으면 다시 잰다', () => {
    const r = judgeMotionTokens(
      [{ value: E1, count: 15 }], [{ value: '0.3s', count: 2 }], [E1], ['0.2s'], false)!;
    expect(r.durationMeasurable).toBe(true);
    expect(r.offTokenDurations.map((d) => d.value)).toEqual(['0.3s']);
  });

  test('사각에 그 사실이 «값으로» 있다', () => {
    expect(MOTION_TOKEN_BLIND_SPOTS.join(' ')).toContain('no-duration-tokens');
  });
});
