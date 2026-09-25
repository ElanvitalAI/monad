/**
 * ⛔⭐ 이 시험이 무는 것은 ***「색감이 갈리나」***이지 「보기에 같나」가 아니다.
 *    ⊕ ***색상환이 «원»이라는 것***을 빼먹으면 자가 「가장 가까운 쌍」을 「가장 먼 쌍」으로 낸다.
 */
import { describe, expect, test } from 'bun:test';

import {
  HUE_BLIND_SPOTS, HUE_FAMILY_COUNT, HUE_MIN_CHROMATIC_RATIO, hueFamily, hueFamilyCenterDegrees, hueGap, judgeHueGap,
  readHueProbe, renderHueClusters, renderHueGap, topHueClusters,
} from './hue-signature.js';

describe('hueGap — ⛔ 색상환은 «원»이다', () => {
  test('⛔⭐ ***350° 와 10° 는 «20도»*** — 340 이면 자가 뒤집힌 것이다', () => {
    expect(hueGap(350, 10)).toBe(20);
    expect(hueGap(10, 350)).toBe(20);
  });

  test('최대 거리는 180° 다', () => {
    expect(hueGap(0, 180)).toBe(180);
    expect(hueGap(0, 181)).toBe(179);
  });

  test('⛔ 못 쟀으면 null — 0(=같다)으로 쓰지 않는다', () => {
    expect(hueGap(null, 10)).toBeNull();
    expect(hueGap(10, null)).toBeNull();
    expect(hueGap(Number.NaN, 10)).toBeNull();
  });
});

describe('judgeHueGap — 관문 통과 쌍', () => {
  // ⛔⭐⭐ 관문②(2026-09-13 실측): 원본(파랑) ↔ 산출(라임).
  //    ***그 쌍을 밝기 축은 「거리 0.070 · 같은 계열」로 «못 가른다».***
  test('⛔⭐ ***밝기 축이 «못 가른» 쌍을 가른다*** — 이것이 이 축의 존재 이유다', () => {
    const r = judgeHueGap(212.9, 94.3)!;
    expect(r.gap).toBeCloseTo(118.6, 1);
    expect(r.sameFamily).toBe(false);
  });

  test('같은 색상이면 거리 0 · 같은 무리', () => {
    const r = judgeHueGap(212.9, 212.9)!;
    expect(r.gap).toBe(0);
    expect(r.sameFamily).toBe(true);
  });

  test('⛔ 「무리가 같다」와 「거리가 가깝다」는 다른 값이다', () => {
    // 같은 30° 무리 «안»에서도 거리는 벌어질 수 있다
    const r = judgeHueGap(1, 29)!;
    expect(r.sameFamily).toBe(true);
    expect(r.gap).toBeGreaterThan(20);
  });

  test('⭐ 무리 경계는 «색상환 12등분» — 내 표본 밖에서 온 값이다', () => {
    expect(HUE_FAMILY_COUNT).toBe(12);
    expect(hueFamily(0)).toBe(0);
    expect(hueFamily(359)).toBe(11);
    expect(hueFamily(-1)).toBe(11);   // ⛔ 음수도 감싼다
  });
});

describe('renderHueGap', () => {
  test('⛔ 「못 쟀음」을 「같다」로 쓰지 않는다 ⊕ «왜»를 말한다', () => {
    const line = renderHueGap(null);
    expect(line).toContain('못 쟀다');
    expect(line).toContain('정의되지 않는다');
    expect(line).not.toContain('✅');
  });

  test('⛔⭐ 사각(면적에 이끌린다)을 «항상» 제 줄로 낸다', () => {
    const line = renderHueGap(judgeHueGap(212.9, 94.3));
    expect(line).toContain('면적');
    expect(line.split('\n').length).toBeGreaterThan(1);
  });
});

describe('사각', () => {
  test('⛔⭐ ***「회색엔 색상이 없다」와 「이 자도 대용이다」***를 값으로 말한다', () => {
    const all = HUE_BLIND_SPOTS.join(' ');
    expect(all).toContain('achromatic-undefined');
    expect(all).toContain('not-taste');
    expect(all).toContain('weighted-by-area');
  });
});

describe('readHueProbe — ⛔ 「0」과 「못 쟀음」을 가르는 자리', () => {
  test('유채 픽셀이 바닥 위면 각을 «그대로» 낸다', () => {
    expect(readHueProbe(213.9, 0.669)).toBe(213.9);
    expect(readHueProbe(0, 0.5)).toBe(0);
  });

  test('⛔⭐ ***바닥 밑이면 «못 쟀다»*** — 그럴듯한 각을 내지 않는다', () => {
    // 🩸 실물: 대조 픽스처 넷이 «유채 0.0%» 인데 각은 `51.4°` 라는 수를 냈다.
    expect(readHueProbe(51.4, 0)).toBeNull();
    expect(readHueProbe(213.9, HUE_MIN_CHROMATIC_RATIO / 2)).toBeNull();
  });

  test('바닥 «자체»는 통과한다 — 경계는 「미만」이지 「이하」가 아니다', () => {
    expect(readHueProbe(213.9, HUE_MIN_CHROMATIC_RATIO)).toBe(213.9);
  });

  test('⛔ 한쪽이라도 못 쟀으면 null — 0 으로 접지 않는다', () => {
    expect(readHueProbe(null, 0.5)).toBeNull();
    expect(readHueProbe(213.9, null)).toBeNull();
    expect(readHueProbe(Number.NaN, 0.5)).toBeNull();
    expect(readHueProbe(213.9, Number.NaN)).toBeNull();
  });

  test('각을 0~360 으로 돌려 놓는다', () => {
    expect(readHueProbe(-30, 0.5)).toBe(330);
    expect(readHueProbe(390, 0.5)).toBe(30);
  });

  test('⛔⭐ 사각에 ***두 색이 갈린 화면***이 «값»으로 적혀 있다 — 실측에서 나온 칸이다', () => {
    const joined = HUE_BLIND_SPOTS.join(' ');
    expect(joined).toContain('two-cluster-flip');
    expect(joined).toContain('46.9');
  });
});

describe('topHueClusters — ⛔ 한 각이 «못 보는» 두 색 구성', () => {
  const only = (family: number): number[] => Array.from({ length: HUE_FAMILY_COUNT }, (_, i) => (i === family ? 0.9 : 0));

  test('단색이면 둘째 무리가 «없다»', () => {
    const r = topHueClusters(only(7));
    expect(r?.first).toEqual({ family: 7, weight: 1 });
    expect(r?.second).toBeNull();
    expect(r?.dominance).toBeNull();
  });

  test('⭐ 두 색이면 ***둘 다*** 나오고 «배수»를 낸다', () => {
    const w = Array.from({ length: HUE_FAMILY_COUNT }, () => 0);
    w[0] = 0.5; w[7] = 0.45;            // 관문② 의 실측 꼴(주황 0.500 · 파랑 0.445)
    const r = topHueClusters(w);
    expect(r?.first.family).toBe(0);
    expect(r?.second?.family).toBe(7);
    expect(r?.first.weight).toBeCloseTo(0.5263, 3);
    expect(r?.dominance).toBeCloseTo(1.1, 1);
  });

  test('⛔ 전부 0이면 «못 쟀다» — 「1위가 0」을 내지 않는다', () => {
    expect(topHueClusters(Array.from({ length: HUE_FAMILY_COUNT }, () => 0))).toBeNull();
  });

  test('⛔ 길이가 다르거나 음수·NaN 이면 «못 쟀다»', () => {
    expect(topHueClusters([1, 2, 3])).toBeNull();
    const bad = only(3).slice(); bad[1] = -1;
    expect(topHueClusters(bad)).toBeNull();
    const nan = only(3).slice(); nan[1] = Number.NaN;
    expect(topHueClusters(nan)).toBeNull();
  });

  test('칸의 «중심각»을 낸다 — 0번 칸은 15°, 7번 칸은 225°', () => {
    expect(hueFamilyCenterDegrees(0)).toBe(15);
    expect(hueFamilyCenterDegrees(7)).toBe(225);
  });

  test('⛔⭐ ***「한 색이냐 두 색이냐」를 «안» 판정한다*** — 그 줄이 산출에 있어야 한다', () => {
    const w = Array.from({ length: HUE_FAMILY_COUNT }, () => 0);
    w[0] = 0.5; w[7] = 0.45;
    const line = renderHueClusters(topHueClusters(w));
    expect(line).toContain('«안» 판정한다');
    expect(line).toContain('배');
    expect(renderHueClusters(null)).toContain('못 쟀다');
  });

  test('⛔ 찍는 «자릿수»가 무게의 정밀도와 맞아야 한다 — 「0.0% 인데 9999배」는 모순으로 읽힌다', () => {
    const w = Array.from({ length: HUE_FAMILY_COUNT }, () => 0);
    w[7] = 1; w[3] = 0.0001;
    const line = renderHueClusters(topHueClusters(w));
    expect(line).toContain('0.01%');
    expect(line).not.toContain('대 0.0%');
  });
});
