/**
 * token-pair-validity.test.ts — ⛔ ***이 자의 가장 위험한 축은 「분모를 스스로 부풀리는 것」***이다.
 *    ⓐ 자기 자신 위에서는 대비가 «언제나» 1.0 이라 세면 안 된다.
 *    ⓑ 토큰이 «없을» 때 「깨진 쌍 0」을 내면 ***아무것도 선언 안 한 쪽이 만점***을 받는다.
 */
import { describe, expect, test } from 'bun:test';
import {
  judgeTokenPairs, renderTokenPairs, DISCRIMINATING_GROUND_COUNT,
  TOKEN_PAIR_BLIND_SPOTS, type NamedColor,
} from './token-pair-validity.js';

const c = (name: string, r: number, g: number, b: number): NamedColor => ({ name, rgb: { r, g, b } });

// 📏 jongi-jip 실측값 — 이 자가 태어난 자리다.
const PAPER = c('--paper', 0xf6, 0xf5, 0xef);
const CARD = c('--card', 0xff, 0xff, 0xff);
const TINT = c('--stamp-tint', 0xe7, 0xef, 0xe9);
const INK_SOFT = c('--ink-soft', 0x7e, 0x75, 0x6d);
const INK = c('--ink', 0x2c, 0x2a, 0x29);

describe('judgeTokenPairs', () => {
  test('⛔⭐ 토큰이 «없으면» null — 「깨진 쌍 0」이 아니다', () => {
    expect(judgeTokenPairs([])).toBeNull();
    expect(judgeTokenPairs([INK], [])).toBeNull();
  });

  test('⛔ 자기 자신을 «바탕으로 세지 않는다» — 대비 1.0 이 분모를 부풀린다', () => {
    const r = judgeTokenPairs([INK, PAPER, CARD])!;
    expect(r.reaches.find((x) => x.name === '--ink')!.grounds).toBe(2);
    expect(r.reaches.find((x) => x.name === '--ink')!.readableOn).not.toContain('--ink');
  });

  test('🩸⭐⭐ 실측 재현 — `--ink-soft` 는 «흰 카드 위에서만» 산다', () => {
    const r = judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT])!;
    const soft = r.reaches[0]!;
    expect(soft.readableOn).toEqual(['--card']);   // paper 4.13 · tint 3.85 ⇒ 둘 다 미달
    expect(soft.singleGround).toBe(true);
    expect(r.fragile.map((f) => f.name)).toEqual(['--ink-soft']);
  });

  test('⭐ 어디서나 읽히는 색은 «취약»이 아니다', () => {
    const r = judgeTokenPairs([INK], [PAPER, CARD, TINT])!;
    expect(r.reaches[0]!.readableOn).toHaveLength(3);
    expect(r.reaches[0]!.singleGround).toBe(false);
    expect(r.fragile).toEqual([]);
  });

  test('⛔ 「어디서도 안 읽힌다」와 「하나에서만 읽힌다」를 «다른 칸»으로 낸다', () => {
    const r = judgeTokenPairs([CARD], [PAPER, TINT])!;   // 흰색은 밝은 바탕 어디서도 못 읽힌다
    expect(r.reaches[0]!.noGround).toBe(true);
    expect(r.reaches[0]!.singleGround).toBe(false);
  });

  test('⭐ 큰 글자 문턱(3)을 주면 판정이 «바뀐다» — 문턱이 값에 실린다', () => {
    const small = judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT])!;
    const large = judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT], 28, 400)!;
    expect(small.threshold).toBe(4.5);
    expect(large.threshold).toBe(3);
    expect(large.reaches[0]!.readableOn.length).toBeGreaterThan(small.reaches[0]!.readableOn.length);
  });

  test('바탕을 «안 주면» 글자 후보 자신을 바탕으로 쓴다', () => {
    const r = judgeTokenPairs([INK, PAPER])!;
    expect(r.measuredPairs).toBe(2);
  });
});

describe('renderTokenPairs', () => {
  test('⛔ 「못 쟀음」을 «0» 으로 쓰지 않는다', () => {
    expect(renderTokenPairs(null)).toContain('못 쟀다');
    expect(renderTokenPairs(null)).not.toContain('✅');
  });
  test('취약 토큰의 «이름과 그 하나뿐인 바탕»이 문면에 나온다', () => {
    const line = renderTokenPairs(judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT]));
    expect(line).toContain('--ink-soft');
    expect(line).toContain('--card');
  });
});

describe('사각', () => {
  test('스스로 «못 보는 것»을 값으로 낸다', () => {
    expect(TOKEN_PAIR_BLIND_SPOTS.length).toBeGreaterThan(3);
    expect(TOKEN_PAIR_BLIND_SPOTS.join(' ')).toContain('which-is-ground');
  });
});

// ── 🩸 둘째 사이트가 가르친 것 — ***바탕이 둘뿐이면 이 축은 «변별하지 않는다»*** ──────
describe('바탕 수 — 「취약 9개」를 결함으로 읽지 않게', () => {
  const DARK = c('--dark', 0, 0, 0);
  const PAPER2 = c('--paper', 0xf8, 0xf6, 0xee);

  test('⛔⭐ 바탕이 «둘»이면 discriminating 이 false 다', () => {
    const r = judgeTokenPairs([INK, c('--on-dark', 0xf8, 0xf6, 0xee)], [DARK, PAPER2])!;
    expect(r.groundCount).toBe(2);
    expect(r.discriminating).toBe(false);
  });

  test('⛔ 그때 문면이 «수»보다 «변별 안 함»을 먼저 말한다', () => {
    const line = renderTokenPairs(judgeTokenPairs([INK], [DARK, PAPER2]));
    expect(line).toContain('변별하지 않는다');
    expect(line).toContain('결함으로 읽지 마라');
    expect(line).not.toContain('⚠️');
  });

  test('✅ 바탕이 셋이면 변별한다', () => {
    const r = judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT])!;
    expect(r.groundCount).toBe(3);
    expect(r.discriminating).toBe(true);
    expect(renderTokenPairs(r)).toContain('--ink-soft');
  });

  test('⭐ 「변별 안 함」이어도 «수를 지우지 않는다» — fragile 은 그대로 값에 남는다', () => {
    const r = judgeTokenPairs([INK], [DARK, PAPER2])!;
    expect(r.discriminating).toBe(false);
    expect(r.fragile.length).toBe(1);       // ⛔ 값은 살아 있다
  });

  test('사각에 그 사실이 «값으로» 있다', () => {
    expect(TOKEN_PAIR_BLIND_SPOTS.join(' ')).toContain('needs-three-grounds');
  });
});

// ── ⭐⭐ 이름이 자기 바탕을 «말하나» — ③ 대조가 가르친 규칙 ────────────────────────
describe('declaresGround — 제약을 «이름»에 싣는다', () => {
  const SOFT_NAMED = c('--ink-soft-on-card', 0x7e, 0x75, 0x6d);

  test('⭐ `-on-<바탕>` 으로 끝나고 그 바탕이 «맞으면» 말한 것이다', () => {
    const r = judgeTokenPairs([SOFT_NAMED], [PAPER, CARD, TINT])!;
    expect(r.reaches[0]!.singleGround).toBe(true);
    expect(r.reaches[0]!.declaresGround).toBe(true);
    expect(r.undeclared).toEqual([]);
  });

  test('⛔ 이름이 «안» 말하면 undeclared 에 남는다 — 고칠 것은 이 목록이다', () => {
    const r = judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT])!;
    expect(r.reaches[0]!.declaresGround).toBe(false);
    expect(r.undeclared.map((x) => x.name)).toEqual(['--ink-soft']);
  });

  test('⛔⭐ 「틀린 이름」은 «말한 것이 아니다» — 더 나쁘다', () => {
    const wrong = c('--ink-soft-on-paper', 0x7e, 0x75, 0x6d);   // 실제로는 --card 에서만 산다
    const r = judgeTokenPairs([wrong], [PAPER, CARD, TINT])!;
    expect(r.reaches[0]!.declaresGround).toBe(false);
    expect(r.undeclared).toHaveLength(1);
  });

  test('⛔ `fragile` 을 «대체하지» 않는다 — 이름을 붙여도 제약은 그대로다', () => {
    const r = judgeTokenPairs([SOFT_NAMED], [PAPER, CARD, TINT])!;
    expect(r.fragile).toHaveLength(1);      // ⭐ 여전히 쌍 토큰이다
    expect(r.undeclared).toHaveLength(0);   // ⭐ 다만 «선언돼» 있다
  });

  test('문면이 둘을 «가른다»', () => {
    expect(renderTokenPairs(judgeTokenPairs([SOFT_NAMED], [PAPER, CARD, TINT]))).toContain('«전부» 이름으로');
    expect(renderTokenPairs(judgeTokenPairs([INK_SOFT], [PAPER, CARD, TINT]))).toContain('«안 말하는»');
  });
});
