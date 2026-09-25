/**
 * layout-signature.ts — ***「잉크가 «어디에» 몰렸나」***.
 *
 * ⛔⭐⭐ ⚪H 의 «셋째» 축이다. 앞 둘은 ***「밝은가」***(`brightness-family`)와 ***「무슨 색인가」***(`hue-signature`)를
 *    답한다. 둘 다 ***화면 «전체»의 «한» 수***라 ***「같은 것을 «다른 자리»에 놓은」 두 쪽을 못 가른다.***
 *
 * 🩸 왜 이 자가 필요한가 (실측 2026-09-13 04:04 · 실물 CLI):
 * ```
 * 배치가 «같고» 색만 다른 두 쪽 →  활자 거리 ***0*** · 간격 거리 ***0***
 * ```
 *    구조 자들이 못 갈랐다 — 그건 «옳다»(배치가 같으니까). ⛔ 그런데 ***거꾸로도 못 한다***:
 *    ***배치가 «다른데» 사다리가 같으면 구조 자는 여전히 0 이다.***
 *
 * 📏 ***짓기 «전»에 관문 셋을 통과시켰다***(밝기 1차 후보가 그것을 «안 해서» 떨어졌다):
 * ```
 * 관문①  같은 그림 두 번                     거리 ***0.0000***
 * 관문②  파랑 ↔ ***배치를 바꾼*** 파랑(같은 색) 거리 ***0.7619***
 * 관문③  파랑 ↔ 라임(***배치 같고 색만 다름***) 거리 ***0.0011***   ← 음성 대조
 * ⇒ ***②가 ③의 724배.*** 판정선은 「3배 이상」이었다
 * ```
 * ⭐ 그리고 ***실물 대상으로 한 번 더*** 봤다(⛔ 내가 만든 쪽만으로는 안 닫는다):
 * ```
 * 같은 사이트 두 폭   spotify ***0.0000*** · bun.sh docs ***0.0106***
 * 다른 사이트끼리     ***0.2540 ~ 0.4534***(21쌍)
 * ⇒ 두 무리가 ***24배*** 떨어져 있다. ⛔ 그 수를 «임계»로 박지 않는다 — 아래를 보라
 * ```
 *
 * ⛔ 이 파일은 그림도 파일도 «안 읽는다» — 타일 벡터를 «받는다».
 *    (벡터를 만드는 것은 `scripts/webclone/measure-fidelity.ts` 의 `imageTileStdDevs` — ***이미 있다***)
 */

/** ⛔ 이 자가 ***원리상 «못 보는»*** 것들. */
export const LAYOUT_BLIND_SPOTS: readonly string[] = [
  'not-taste: ***「보기에 같다」가 «아니다»*** — 「잉크가 «어디에» 몰렸나」다(밝기·색감 축과 같은 계급)',
  'ink-not-meaning: ***가장자리 밀도***를 본다 — 같은 자리에 «다른 것»이 같은 밀도로 있으면 «같다»고 한다',
  'one-viewport: «첫 화면» 한 폭만 본다 — 스크롤 아래는 «안 본다»',
  'same-size-only: ***두 그림의 타일 «수»가 같아야 한다*** — 다르면 «못 쟀다»를 낸다(크기를 맞추는 것은 부르는 쪽 몫)',
  'flat-page-undefined: ***가장자리가 «하나도» 없는 화면***(순백·순흑)은 분포가 «정의되지 않는다» ⇒ «못 쟀다»',
  // ⛔⭐⭐ 이것이 이 자의 «가장 큰» 사각이다 — 아래 `judgeLayoutGap` 주석이 이유를 댄다.
  'no-threshold: ***「같은 배치인가」를 «판정하지 않는다»*** — 수만 낸다. 임계를 두면 그 수가 «내 표본»에서 오기 때문이다',
];

/** 관문·실물 관측을 «값으로» 들고 다닌다. ⛔ ***임계가 아니라 「내가 본 것」***이다. */
export const LAYOUT_OBSERVED_SAME_SITE = '0.000 ~ 0.011 (같은 사이트 두 폭 · n=2)';
export const LAYOUT_OBSERVED_DIFFERENT_SITE = '0.254 ~ 0.453 (다른 사이트끼리 · n=21)';

export interface LayoutGap {
  /** 총변동 거리 0~1. 0 이면 잉크 분포가 같다. */
  readonly distance: number;
  readonly tiles: number;
}

/**
 * ⭐ 두 타일 벡터의 ***총변동 거리***(normalized L1 / 2). 0~1.
 *
 * ⛔ ***합으로 «정규화»한다*** — 안 그러면 「전체가 더 진한 화면」이 「배치가 다르다」로 읽힌다.
 *    그건 밝기 축의 물음이지 이 자의 물음이 아니다.
 * ⛔ 길이가 다르거나 한쪽이 «평평»하면(합 0) `null` — ***「같다」를 지어내지 않는다.***
 */
export function layoutDistance(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  if (a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) return null;
  const sa = a.reduce((s, x) => s + x, 0);
  const sb = b.reduce((s, x) => s + x, 0);
  if (sa <= 0 || sb <= 0) return null;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc += Math.abs(a[i]! / sa - b[i]! / sb);
  return Math.round((acc / 2) * 10000) / 10000;
}

/**
 * ⛔⭐⭐⭐ ***이 자는 「같은 배치인가」를 «판정하지 않는다». 일부러 그렇다.***
 *
 * 🩸 임계를 두려면 그 수가 «어디»서 와야 하나. 밝기 축은 ***삼등분 관례***, 색감 축은 ***색상환 12등분***
 *    — 둘 다 ***내 표본 «밖»***에서 왔다. ⛔ ***배치 거리에는 그런 바깥 관례가 «없다».***
 *    ⇒ 내가 고를 수 있는 임계는 전부 ***내 9판 코퍼스***, 즉 ***「피판정자가 낸 값」***에서 온다.
 *    이 저장소가 이름 붙인 실패 모양이 정확히 그것이다.
 * ✅ 그래서 ***수를 내고, 내가 «본 것»을 나란히 적는다.*** 판정은 읽는 사람이 한다.
 */
export function judgeLayoutGap(a: readonly number[], b: readonly number[]): LayoutGap | null {
  const distance = layoutDistance(a, b);
  if (distance === null) return null;
  return { distance, tiles: a.length };
}

/** 사람이 읽을 한 줄. ⛔ 「못 쟀음」을 「같다」로 쓰지 않는다. */
export function renderLayoutGap(report: LayoutGap | null): string {
  if (report === null) {
    return '⚪ 배치를 «못 쟀다» — 두 그림의 타일 수가 다르거나 한쪽에 ***가장자리가 없다***(순백·순흑이면 분포가 «정의되지 않는다»)';
  }
  return `거리 ${report.distance} (타일 ${report.tiles}칸)\n`
    + `  ⚪ ⛔ ***이 자는 「같다/다르다」를 «안» 판정한다*** — 바깥 관례가 없어 임계가 «내 표본»에서 올 수밖에 없다\n`
    + `  📏 내가 «본» 것:  같은 사이트 ${LAYOUT_OBSERVED_SAME_SITE}  ·  다른 사이트 ${LAYOUT_OBSERVED_DIFFERENT_SITE}`;
}
