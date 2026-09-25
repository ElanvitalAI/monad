/**
 * ⛔⭐ 이 시험이 무는 것은 ***「밝기 계열이 갈리나」***이지 「보기에 같나」가 아니다.
 *    후자는 이 자도 «대용»이고, 사각이 그것을 «먼저» 말해야 한다.
 */
import { describe, expect, test } from 'bun:test';

import {
  BRIGHTNESS_BLIND_SPOTS, BRIGHTNESS_DARK_MAX, BRIGHTNESS_LIGHT_MIN,
  brightnessFamily, judgeBrightnessGap, renderBrightnessGap,
} from './brightness-family.js';

describe('brightnessFamily — 삼등분', () => {
  test('⛔ 경계는 «삼등분»이다 — 내 표본에 맞춘 값이 «아니다»', () => {
    expect(BRIGHTNESS_DARK_MAX).toBeCloseTo(1 / 3, 6);
    expect(BRIGHTNESS_LIGHT_MIN).toBeCloseTo(2 / 3, 6);
  });

  test('어둡다 / 중간 / 밝다', () => {
    expect(brightnessFamily(0.05)).toBe('dark');
    expect(brightnessFamily(0.5)).toBe('mid');
    expect(brightnessFamily(0.95)).toBe('light');
  });
});

describe('judgeBrightnessGap', () => {
  // ⛔⭐⭐ ***정답을 아는 쌍***(2026-09-12 실측 · `aialy.app`):
  //    구조 자(활자 분포)는 이 둘을 0.744 ↔ 0.756 으로 «붙여» 놨다. 이 자는 갈라야 한다.
  test('⛔⭐ ***구조 자가 «못 가른» 쌍을 가른다*** — 이것이 이 자의 존재 이유다', () => {
    const tried = judgeBrightnessGap(0.193, 0.123)!;     // 클론을 «시도»한 산출
    const didNot = judgeBrightnessGap(0.193, 0.874)!;    // 클론을 «시도조차 안 한» 산출
    expect(tried.sameFamily).toBe(true);
    expect(didNot.sameFamily).toBe(false);
    // ⭐ 수로도 갈린다 — 「같다/다르다」만이 아니라 «거리»가 크게 벌어진다
    expect(didNot.gap).toBeGreaterThan(tried.gap * 5);
  });

  test('⛔ 한쪽이라도 «못 쟀으면» null — 「같다」를 지어내지 않는다', () => {
    expect(judgeBrightnessGap(0.5, null)).toBeNull();
    expect(judgeBrightnessGap(null, 0.5)).toBeNull();
    expect(judgeBrightnessGap(Number.NaN, 0.5)).toBeNull();
  });

  test('같은 값이면 거리 0 · 같은 계열', () => {
    const r = judgeBrightnessGap(0.2, 0.2)!;
    expect(r.gap).toBe(0);
    expect(r.sameFamily).toBe(true);
  });

  test('⛔⭐ 「계열이 같다」와 「거리가 가깝다」는 «다른 값»이다', () => {
    // 0.01 과 0.33 은 둘 다 «어둡다» 인데 거리가 0.32 다
    const r = judgeBrightnessGap(0.01, 0.33)!;
    expect(r.sameFamily).toBe(true);
    expect(r.gap).toBeGreaterThan(0.3);
  });
});

describe('renderBrightnessGap', () => {
  test('⛔ 「못 쟀음」을 「같다」로 쓰지 않는다', () => {
    expect(renderBrightnessGap(null)).toContain('못 쟀다');
    expect(renderBrightnessGap(null)).not.toContain('✅');
  });

  test('⛔⭐ 사각(색상을 안 본다)을 «항상» 같이 낸다 — 판정과 다른 줄로', () => {
    const line = renderBrightnessGap(judgeBrightnessGap(0.1, 0.15));
    expect(line).toContain('✅');
    expect(line).toContain('색상');
    expect(line.split('\n').length).toBeGreaterThan(1);
  });

  test('수를 «문면»에 낸다 — 「다르다」만으로는 다음 사람이 못 쓴다', () => {
    const line = renderBrightnessGap(judgeBrightnessGap(0.193, 0.874));
    expect(line).toContain('0.193');
    expect(line).toContain('0.874');
    expect(line).toContain('0.681');
  });
});

describe('사각', () => {
  test('⛔⭐ ***「이 자도 대용이다」***를 값으로 말한다', () => {
    const all = BRIGHTNESS_BLIND_SPOTS.join(' ');
    expect(all).toContain('hue-blind');
    expect(all).toContain('not-taste');
    expect(BRIGHTNESS_BLIND_SPOTS.length).toBeGreaterThan(3);
  });
});
