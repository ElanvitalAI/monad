/**
 * token-pair-validity.ts — ***「이 색 토큰은 «몇 개의 바탕» 위에서 읽히나」***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-12 🅕) — ***③ 칸의 대조 실험이 이것을 «실패로» 가르쳐 줬다.***
 *
 * 📏 한 사이트(`jongi-jip`)의 토큰 파일을 ***한 글자도 안 고치고*** 「전혀 다른 컨셉」(연표)을 지었다.
 *    `type-ladder`·`token-adherence` 는 ***둘 다 통과***했는데, 글자 대비가 걸렸다:
 * ```
 *   --ink-soft (#7e756d) on --paper (#f6f5ef)   4.13  ⛔
 *   --ink-soft (#7e756d) on --card  (#ffffff)   4.51  ✅   ← ***원본은 여기서만 맞췄다***
 * ```
 *    원본은 «카드 목록»이라 보조 글자가 «흰 카드 위»에 있었고, 새 컨셉엔 ***카드가 없다.***
 * ⇒ 🔑 ***토큰은 옮겨져도 「쌍」은 «안» 옮겨진다.***
 *    ***정보 구조가 바뀌면 «바탕»이 바뀌고, 바탕이 바뀌면 색 토큰의 일부가 «무효»가 된다.***
 *
 * ⛔⭐⭐ 그래서 이 자는 ***「지금 화면」이 아니라 「토큰 파일」***을 본다 —
 *    ***짓기 «전»에*** 「이 색은 어디서만 산다」를 말한다(`web-contrast` 는 «지은 뒤»를 본다).
 *
 * ⛔⭐ ***어느 토큰이 «바탕»인지 «추측하지 않는다».*** 파일만으로는 알 수 없다.
 *    ⇒ 대신 ***모든 쌍***을 재고 「몇 개 위에서 읽히나」를 낸다. 부르는 쪽이 바탕 목록을 알면 좁혀 준다.
 *
 * ⛔ 대비 «계산»은 재발명하지 않는다 — `web-contrast.ts` 를 부른다.
 */

import { contrastRatio, requiredRatio, type Rgb255 } from './web-contrast.js';

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const TOKEN_PAIR_BLIND_SPOTS: readonly string[] = [
  'which-is-ground: 어느 토큰이 «바탕»인지 «모른다» — 모든 쌍을 재고 부르는 쪽이 좁힌다',
  'alpha-and-images: 반투명·그라디언트·이미지 바탕은 못 본다(불투명 «선언값»만)',
  'never-used-pairs: «쓰이지 않을» 쌍도 센다 — 「깨졌다」가 아니라 「거기선 못 쓴다」는 뜻이다',
  'one-threshold: 문턱 하나로 잰다 — 큰 글자(3)와 작은 글자(4.5)를 섞어 쓰는 토큰은 부르는 쪽이 갈라야 한다',
  'no-taste: 「그 색이 «예쁜가»」는 안 묻는다 — 「읽히나」만 묻는다',
  'needs-three-grounds: 바탕이 셋 미만이면 «변별하지 않는다» — 밝음/어두움 둘뿐이면 거의 다 「하나에서만」이다',
];

/** 색 하나. */
export interface NamedColor {
  readonly name: string;
  readonly rgb: Rgb255;
}

/** 한 토큰의 판정. */
export interface TokenReach {
  readonly name: string;
  /** 이 색이 «읽히는» 바탕 이름들 */
  readonly readableOn: readonly string[];
  /** 잰 바탕 수. ⛔ 이것이 분모다 */
  readonly grounds: number;
  /**
   * ⛔⭐⭐ ***「쌍 토큰」*** — 읽히는 바탕이 «하나뿐»이다.
   * ⇒ ***그 바탕이 없는 컨셉으로 옮기면 «조용히» 무효가 된다.***
   */
  readonly singleGround: boolean;
  /** 어디서도 안 읽힌다 — 글자색으로는 못 쓴다(바탕 전용일 «수» 있다) */
  readonly noGround: boolean;
  /**
   * ⭐⭐ ***이름이 자기 바탕을 «말하나»*** — `--ink-soft-on-card` 처럼 `-on-<바탕>` 으로 끝나고
   *    그 바탕이 ***실제로 유일하게 읽히는 바탕***일 때 참이다.
   *
   * 🩸 왜 이 칸이 있나(2026-09-12 ③ 대조): 같은 「쌍 토큰」인데 ***이름이 말하는 쪽은 안 깨졌고
   *    말 안 하는 쪽은 깨졌다.*** ⇒ ***제약은 「이름」에 실을 수 있다.***
   * ⛔ 이 칸이 참이어도 ***제약이 «사라진» 것이 아니다*** — 「선언됐다」일 뿐이다.
   */
  readonly declaresGround: boolean;
}

/**
 * ⛔⭐⭐ ***이 축이 «변별하는 최소 바탕 수».***
 *
 * 🩸 2026-09-12 실측 — 둘째 사이트(`dongne-moksori`)에 대니 ***9개 중 9개가 「취약」***으로 나왔다.
 *    그 사이트의 바탕은 ***둘***(`--dark` ⊕ `--paper`)이다. 바탕이 둘뿐이면
 *    ***「하나에서만 읽힌다」가 거의 «언제나» 참이다*** — 색은 밝은 쪽이나 어두운 쪽 «하나»에 속하니까.
 * ⇒ 🔑 ***그 9는 「이 디자인이 취약하다」가 아니라 「이 자가 여기선 «변별하지 않는다»」다.***
 * ⛔ 그래서 수를 «지우지 않고» ***「변별하나」를 «값으로» 같이 낸다.***
 */
export const DISCRIMINATING_GROUND_COUNT = 3;

export interface TokenPairReport {
  readonly measuredPairs: number;
  readonly reaches: readonly TokenReach[];
  /** `singleGround` 인 것들 — ***③ 칸에서 가장 먼저 깨질 토큰들*** */
  readonly fragile: readonly TokenReach[];
  /**
   * ⭐⭐ `fragile` 중 ***이름이 자기 바탕을 «안» 말하는 것들*** — ***고칠 것은 이 목록이다.***
   * ⛔ `fragile` 을 «대체하지» 않는다 — 제약은 이름을 붙여도 그대로 있다.
   */
  readonly undeclared: readonly TokenReach[];
  readonly threshold: number;
  /** 잰 바탕 수(자기 자신을 뺀 최대값). ⛔ 이것이 「취약」의 분모다 */
  readonly groundCount: number;
  /**
   * ⛔⭐⭐ ***바탕이 `DISCRIMINATING_GROUND_COUNT` 보다 적으면 이 축은 «변별하지 않는다».***
   *    「취약 N개」를 ***결함으로 읽지 마라*** — 「안 재고 있다」에 가깝다.
   */
  readonly discriminating: boolean;
}

/**
 * 토큰들끼리 «전부» 대 본다.
 *
 * ⛔ 글자 후보가 비거나 바탕 후보가 비면 `null` — ***「깨진 쌍 0」이 «아니다»***.
 * ⭐ `grounds` 를 안 주면 ***글자 후보 «자신»을 바탕으로도 쓴다***(파일만 있을 때의 정직한 기본값).
 */
export function judgeTokenPairs(
  foregrounds: readonly NamedColor[],
  grounds: readonly NamedColor[] | null = null,
  fontSizePx = 16,
  fontWeight = 400,
): TokenPairReport | null {
  if (foregrounds.length === 0) return null;
  const bgs = grounds === null ? foregrounds : grounds;
  if (bgs.length === 0) return null;
  const threshold = requiredRatio(fontSizePx, fontWeight);
  const reaches = foregrounds.map((fg) => {
    // ⛔ 자기 자신 위에서는 «언제나» 1.0 이라 세지 않는다 — 분모가 조용히 부푼다.
    const others = bgs.filter((bg) => bg.name !== fg.name);
    const readableOn = others.filter((bg) => contrastRatio(fg.rgb, bg.rgb) >= threshold).map((bg) => bg.name);
    const singleGround = readableOn.length === 1;
    return {
      name: fg.name,
      readableOn,
      grounds: others.length,
      singleGround,
      noGround: readableOn.length === 0,
      // ⛔ 「이름이 말한다」는 ***그 바탕이 «맞을» 때만*** 참이다 — 틀린 이름은 «더» 나쁘다.
      declaresGround: singleGround && fg.name.endsWith(`-on-${readableOn[0]!.replace(/^--/, '')}`),
    };
  });
  const groundCount = reaches.reduce((max, r) => Math.max(max, r.grounds), 0);
  return {
    measuredPairs: reaches.reduce((sum, r) => sum + r.grounds, 0),
    reaches,
    fragile: reaches.filter((r) => r.singleGround),
    undeclared: reaches.filter((r) => r.singleGround && !r.declaresGround),
    threshold,
    groundCount,
    discriminating: groundCount >= DISCRIMINATING_GROUND_COUNT,
  };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「0」으로 쓰지 않는다. */
export function renderTokenPairs(report: TokenPairReport | null): string {
  if (report === null) return '⚪ 못 쟀다 — 색 토큰을 «하나도» 못 읽었다(「깨진 쌍 0」이 아니다)';
  // ⛔⭐ 바탕이 적으면 수를 내기 «전»에 「변별 안 함」을 먼저 말한다 — 안 그러면 그 수가 결함으로 읽힌다.
  if (!report.discriminating) {
    return `⚪ 바탕이 ${report.groundCount}개뿐이라 이 축은 «변별하지 않는다»`
      + `(${DISCRIMINATING_GROUND_COUNT}개 이상이라야 한다) — 「취약 ${report.fragile.length}개」를 «결함으로 읽지 마라»`;
  }
  if (report.fragile.length === 0) {
    return `✅ 쌍 ${report.measuredPairs}개를 쟀다 — «바탕 하나에서만 사는» 토큰이 없다(문턱 ${report.threshold})`;
  }
  const declared = report.fragile.length - report.undeclared.length;
  const tail = declared === 0 ? '' : ` ⊕ ***이름이 «말하는» 것 ${declared}개***(그 제약은 그대로지만 «선언돼» 있다)`;
  if (report.undeclared.length === 0) {
    return `✅ 쌍 토큰 ${report.fragile.length}개가 «전부» 이름으로 자기 바탕을 «말한다»(문턱 ${report.threshold})`;
  }
  const names = report.undeclared.map((r) => `${r.name}(오직 ${r.readableOn[0]})`).join(' · ');
  return `⚠️ ***바탕 «하나»에서만 사는데 이름이 «안 말하는» 토큰 ${report.undeclared.length}개*** — ${names}`
    + ` ⇒ 그 바탕이 «없는» 컨셉으로 옮기면 조용히 무효가 된다${tail}`;
}
