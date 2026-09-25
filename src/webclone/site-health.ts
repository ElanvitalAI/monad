/**
 * site-health.ts — ***자가 낸 경고를 «모아서 세고», 지난번과 «대 본다»***.
 *
 * ⛔⭐⭐⭐ 왜 있나(2026-09-11 🅕 · 외부 조사 `RESEARCH-webclone-methodology-external-review`):
 *    바깥 문헌이 「Design Loop」라 부르는 것은 ***재기 → 고치기 → «다시 재기»***다.
 *    ***이 저장소의 파이프라인은 «재기만» 했다.***
 *    📏 실측이 그것을 바로 보였다 — `extract-computed http://127.0.0.1:8816/` 가
 *    `typographyWarnings: [{role:'h3', violation:'not-larger-than-body'}]` 를 내고 있었는데
 *    ***아무도 그것을 고치지 않았다.*** 자가 낸 경고를 «모아 두는 자리»가 없었기 때문이다.
 *
 * ⛔ 이 파일이 답하는 것: 「내가 지은 사이트들이 «지금» 무슨 경고를 내고 있나」
 *                       ⊕ 「지난번과 대면 «줄었나 늘었나»」.
 * ⛔ 답하지 않는 것: 「그 경고를 어떻게 고치나」(그것은 사람·에이전트의 몫이다).
 *
 * ⛔⭐ 이 파일은 브라우저를 «안 띄운다» — 순수 함수다. 실행은 `scripts/webclone/site-health.ts`.
 */

/**
 * ⛔⭐ 이 자가 ***원리상 «못 보는»*** 것들 — 표 아래에 «값으로» 실린다.
 * 📌 이 자는 «모으는 자»라, 부르는 하위 자들의 사각을 «그대로» 물려받는다.
 */
export const SITE_HEALTH_BLIND_SPOTS: readonly string[] = [
  'one-moment: 각 장을 «한 시점»만 본다 — 클릭·스크롤 «뒤»에 생기는 것은 안 본다',
  'crawl-limit: 내부 링크를 «`--crawl N` 장»까지만 따라간다 — 그 밖의 장은 «안 쟀음»이다',
  'tokens-optional: 토큰 파일을 «안 주면» 「토큰 밖 색」 축을 «안 잰다»(「이탈 0」이 아니다)',
  'no-interaction: 폼을 «채우거나 눌러» 보지 않는다 — 그 뒤의 상태는 다른 축이다',
  'inherits-sub-blind-spots: 하위 자(어포던스·픽셀·토큰)의 사각을 «그대로» 물려받는다',
];

/** 한 사이트가 낸 경고 하나. ⛔ 「무엇이」와 「어디서」를 접지 않는다. */
export interface HealthFinding {
  /** 경고의 갈래 — 표에서 «묶는» 키다 */
  readonly kind:
    | 'typography-hierarchy'   // 활자 위계가 불가능하다
    | 'heading-level-skip'     // 제목 «단계»를 건너뛴다 (h1 → h3)
    | 'role-unrepresentative'  // 고른 모양이 그 역할의 «대표»가 아니다
    | 'painted-unreadable'     // 실제 칠해진 색을 «못 셌다»
    | 'pixel-untrustworthy'    // 픽셀 축을 못 믿는다
    | 'mirror-under-painted'   // 사본이 원본보다 «덜» 칠했다 — 그림이 안 그려졌다
    | 'undeclared-pair-token' // 바탕 하나에서만 사는데 «이름이 안 말한다»
    | 'off-token-motion'      // 쓴 «곡선·지속»이 선언한 토큰 밖이다
    | 'off-scale-space'       // 띄운 «간격»이 선언한 눈금 밖이다
    | 'off-ladder-size'      // 칠한 «크기»가 선언된 활자 사다리 밖이다
    | 'off-token-color'        // 화면이 칠한 색이 «토큰에서 안 왔다»
    | 'silent-to-machines'     // 화면으론 선택을 보여 주는데 기계에 «안 알린다»
    | 'text-unreadable';       // 글자가 바탕과 «안 갈린다»(WCAG 대비)
  /** 어느 자리인가 — 역할 이름이나 축 이름 */
  readonly where: string;
  /** 사람이 읽을 한 줄 */
  readonly detail: string;
  /**
   * ⛔⭐ ***어느 «장»에서 났나.*** 이 칸이 없어서 「루트 한 장」의 사실이 「사이트의 사실」로 읽혔다.
   * ⚪ 옛 산출에는 «없다» — 없으면 「루트」가 아니라 «못 적었음»이다.
   */
  readonly page?: string;
}

export interface SiteHealth {
  readonly site: string;
  readonly url: string;
  /**
   * ⛔⭐ 「경고 0」과 「못 쟀음」은 «다른 값»이다.
   *    측정 자체가 실패하면 `findings: []` 가 아니라 `measured: false` 다 —
   *    그러지 않으면 ***자를 못 돌린 사이트가 「건강하다」로 읽힌다***.
   */
  readonly measured: boolean;
  readonly findings: readonly HealthFinding[];
  /**
   * ⛔⭐ ***몇 «장»을 봤나.*** 표가 이것을 내야 읽는 사람이 「한 장짜리 판정」을 오해하지 않는다.
   * ⚪ 옛 산출에는 «없다».
   */
  readonly pagesSeen?: number;
  /** 못 쟀을 때 «왜» 못 쟀나. 쟀으면 null */
  readonly unmeasuredReason: string | null;
  /**
   * ⭐ 「경고는 아니지만 알아 둘 것」. ⛔ 여기 있는 것은 ***수리 대상이 아니다*** —
   *    그러나 «사라지지도» 않는다. 읽는 쪽이 판단한다.
   * ⚪ 옛 산출에는 «없다».
   */
  readonly observations?: readonly string[];
}

/**
 * `이름=URL` 줄 목록을 읽는다. `#` 로 시작하는 줄과 빈 줄은 건너뛴다.
 * ⭐ `이름=URL|토큰1,토큰2` 로 «토큰 파일»을 같이 줄 수 있다 — 그러면 「토큰 밖 색」도 잰다.
 * ⛔ 옛 형식(`|` 없음)은 «그대로» 돈다 — 토큰을 안 주면 그 축을 «안 잰다»(「이탈 0」이 아니다).
 */
/**
 * 한 대상. ⭐ `styles` 는 ***「어느 토큰이 글자이고 어느 것이 바탕인가」를 «재는» 파일***이다
 * (`check-token-pairs --from-css`). ⛔ 안 주면 그 축을 «안 잰다» — 「0」이 아니다.
 */
export interface HealthTarget {
  readonly name: string;
  readonly url: string;
  readonly tokens: readonly string[];
  readonly styles: readonly string[];
}

export function parseTargets(text: string): ReadonlyArray<HealthTarget> {
  const out: HealthTarget[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const rest = line.slice(eq + 1).trim();
    // ⭐ 칸은 `|` 로 갈린다: URL | 토큰들 | 스타일들.
    // ⛔ 셋째 칸이 «없어도» 둘째 칸의 뜻이 안 바뀐다(옛 줄이 그대로 산다).
    const parts = rest.split('|');
    const url = (parts[0] ?? '').trim();
    const list = (i: number) => (parts[i] ?? '').split(',').map((p) => p.trim()).filter((p) => p !== '');
    if (url === '') continue;
    out.push({ name: line.slice(0, eq).trim(), url, tokens: list(1), styles: list(2) });
  }
  return out;
}

/**
 * ⛔⭐⭐ 🩸 2026-09-11 — ***자가 「URL 한 장」을 보고 «사이트»를 판정했다.***
 *    📏 실측: 13개 중 11개가 `role-missing: button` 을 받았는데,
 *    ***그 폼은 «상세 페이지»에 있었다***(`/lessons/kimchi-01` → `button 1 · form 1 · input 4`).
 *    ⇒ ***11/13 이 «오판»이었다.*** 루트만 보고 「버튼이 없는 사이트」라 말한 것이다.
 *
 * ⭐ 그래서 «내부 링크»를 긁어 사이트를 몇 장 더 본다.
 * ⛔ 자산을 링크로 세지 않는다 — `/_next/…`·확장자가 붙은 것은 «페이지»가 아니다.
 * ⛔ 바깥 링크를 따라가지 않는다(`//`·`http` 로 시작하는 것).
 * ⛔ 순서를 «문서 순서»로 보존한다 — 정렬하면 「첫 N장」이 매 판 달라져 대 보기가 깨진다.
 */
export function internalPaths(html: string, limit: number): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>(['/']);
  for (const m of html.matchAll(/href="(\/[^"'#?\s][^"'#?\s]*)"/g)) {
    if (out.length >= limit) break;
    const path = m[1]!;
    if (path.startsWith('//') || path.startsWith('/_')) continue;
    // 확장자가 붙은 것은 자산이다(`.css`·`.js`·`.png` …). 경로 마지막 칸에 점이 있으면 거른다.
    const last = path.slice(path.lastIndexOf('/') + 1);
    if (last.includes('.')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** `extract-computed --json` 산출에서 경고를 «뽑는다». ⛔ 없는 칸을 0 으로 채우지 않는다. */
export function findingsFromComputed(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const out: HealthFinding[] = [];

  // ⛔⭐⭐ 🩸 이 창의 «마지막» 같은 구멍 — ***역할 표가 «비면» 활자 위계 축이 조용했다.***
  //    ⛔ 「위계가 옳다」가 «아니라» ***「역할을 하나도 못 읽었다」***다.
  //    ⛔⭐ 「칸이 «아예 없다」」(옛 산출)와 「칸이 «있는데 비었다」」를 «가른다» — 지어내지 않는다.
  const roles = o.roles;
  if (roles !== undefined && (roles === null || (typeof roles === 'object' && Object.keys(roles as object).length === 0))) {
    out.push({
      kind: 'typography-hierarchy',
      where: 'roles',
      detail: '역할을 «하나도» 못 읽었다 — 「위계가 옳다」가 아니라 «이 판에서 못 쟀다»',
    });
  }

  const warnings = o.typographyWarnings;
  if (Array.isArray(warnings)) {
    for (const w of warnings) {
      if (w === null || typeof w !== 'object') continue;
      const { role, violation } = w as { role?: unknown; violation?: unknown };
      if (typeof role !== 'string' || typeof violation !== 'string') continue;
      out.push({
        kind: 'typography-hierarchy',
        where: role,
        detail: violation === 'not-larger-than-body'
          ? `${role} 이 본문보다 «크지 않다»`
          : `${role} 이 앞선 제목보다 «작지 않다»`,
      });
    }
  }

  const missing = o.missing;
  const missingSet = new Set(Array.isArray(missing) ? missing.filter((r): r is string => typeof r === 'string') : []);
  // ⛔⭐⭐ 🩸 2026-09-11 — ***「역할이 없다」를 «경고»로 세지 않는다.***
  //    📏 전수 실측: 35건(button 19 · h3 12 · h2 4)이 나왔는데 ***실제 결함은 0에 가까웠다*** —
  //    짧은 상세 페이지엔 `h3` 가 원래 없고, 서버 렌더 링크 UI 에는 `<button>` 이 «정당하게» 없다.
  //    ⇒ 13/13 이 걸리는 «순수 잡음»이 되어 ***진짜 신호(`silent-to-machines` 6건)를 묻었다.***
  //    ⛔ 이 저장소의 규율 그대로다 — ***판정률이 이상하게 높으면 대상이 아니라 «자»를 의심한다.***
  // ✅ 대신 `observationsFromComputed` 가 «값»으로 낸다 — 사라지지 «않고», 경고 수에만 «안» 들어간다.
  //    그리고 진짜 결함(`heading-level-skip`)은 이 `missingSet` 을 근거로 «그대로» 계산된다.

  // ⛔⭐⭐ 🩸 「h2 가 없다」 하나만으로는 «결함인지» 알 수 없다 —
  //    ***짧은 페이지에 h2 가 없는 것은 정상***이고, ***h3 가 «있는데» h2 가 없으면 «건너뜀»이다***.
  //    📏 실측 2026-09-11: `dongne-hansu` 의 상세가 정확히 그랬다(h1 ⊕ h3 · h2 없음).
  //    ⛔ 「없다」를 세지 말고 「무엇이 있는데 무엇이 없나」를 봐라 — 이것이 이 자의 규율이다.
  //    ⚠️ `missing` 이 «없는» 옛 산출에서는 이 칸을 «안 낸다» — 못 쟀음을 「건너뜀 없음」으로 접지 않는다.
  if (Array.isArray(missing)) {
    // 「빠진 단계 ↔ 그보다 낮은데 «쓰인» 단계」 — 짝이 맞으면 그것이 «건너뜀»이다.
    const PAIRS: ReadonlyArray<readonly [missingLevel: string, usedBelow: string]> = [['h1', 'h2'], ['h2', 'h3']];
    for (const [missingLevel, usedBelow] of PAIRS) {
      if (!missingSet.has(missingLevel)) continue;   // 그 단계가 «있다» — 건너뜀이 아니다
      if (missingSet.has(usedBelow)) continue;       // 더 낮은 단계도 «없다» — 그냥 짧은 페이지다
      out.push({
        kind: 'heading-level-skip',
        where: missingLevel,
        // ⛔⭐ 🩸 2026-09-11 — ***이 자가 「왜」를 틀리게 말했다.***
        //    📏 실측: `nike.com` 에 `h1` 이 «2개 있는데» 둘 다 `0x0`(display:block · visibility:visible)이다.
        //    ⇒ 이 자의 모집단은 ***「보이는」 요소***라 「없다」로 세지만,
        //       ***읽어 주는 기계는 `display:none` 이 아닌 한 «읽는다».***
        //    ⇒ 그래서 사유를 ***«시각 축»으로*** 바꾼다 — 접근성 주장을 하지 않는다.
        //    ⚪ 「DOM 엔 있는데 안 보인다」를 «따로» 세는 것은 다른 축이고 아직 안 잰다.
        detail: `화면에서 제목 «${missingLevel}» 단계가 건너뛰어지고 «${usedBelow}» 가 쓰였다`
          + ` — ⚠️ DOM 에는 «있으나 안 보이는» 제목일 수 있다(이 자는 «보이는» 것만 센다)`,
      });
    }
  }

  // ⭐ 「고른 값이 대표가 아니다」 — 이 칸은 `diagnostics` 가 «스스로» 신고한다.
  //    ⛔ `chosenCount` 가 없는 옛 산출은 «못 쟀음»이지 「대표다」가 아니다 ⇒ 건너뛴다.
  const diagnostics = o.diagnostics;
  if (diagnostics !== null && typeof diagnostics === 'object') {
    for (const [role, d] of Object.entries(diagnostics as Record<string, unknown>)) {
      if (d === null || typeof d !== 'object') continue;
      // ⛔⭐ 🩸 이 값은 «비율»이 아니라 «개수»다 — 옛 이름 `chosenShare` 를 보고 «비율»로 읽어
      //    이 축이 ***152 표본에서 0건***이 됐다(퇴화 검사 ⓐ). `design-md.ts` 는 «개수»로 옳게 읽고 있었다.
      const { chosenCount, visible } = d as { chosenCount?: unknown; visible?: unknown };
      if (typeof chosenCount !== 'number' || typeof visible !== 'number') continue;
      // 「고른 모양이 과반이 아니다」 — `count * 2 <= visible`(design-md 와 «같은» 계약).
      if (visible >= 4 && chosenCount * 2 <= visible) {
        out.push({
          kind: 'role-unrepresentative',
          where: role,
          detail: `${role}: 고른 모양을 보이는 ${visible}개 중 ${chosenCount}개만 입었다 — «대표»가 아니다`,
        });
      }
    }
  }

  if (o.paintedColors === null) {
    out.push({ kind: 'painted-unreadable', where: 'paintedColors', detail: '실제 칠해진 색을 «못 셌다»(요소 순회 실패)' });
  }

  return out;
}

/**
 * `check-token-adherence --json` 산출에서 「토큰 밖 색」 경고를 뽑는다.
 *
 * ⛔⭐ 이 칸이 있는 이유: ***conform 일곱 축이 «전부 한 방향»(재현율)이었다*** —
 *    「씨앗 토큰을 다 쓰고 «그 밖에 아무거나 더» 썼다」도 7/7 만점이 나온다.
 * ⛔ `adherence` 가 `null` 이면 «못 쟀음»이다 — 「이탈 0」으로 접지 않는다.
 */
export function findingsFromAdherence(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  const adherence = top.adherence;
  // ⛔⭐⭐ 🩸 `findingsFromSpace`·`findingsFromLadder` 와 «같은 구멍»이 여기에도 있었다 —
  //    판정 함수의 `null`(「못 쟀다」)을 ***「이탈 0」과 «똑같이» 조용히*** 넘기고 있었다.
  //    (그 구멍이 간격 축에서 ***전수의 「4 → 0」이라는 «거짓 개선»***을 냈다.)
  // ⇒ ✅ 「토큰은 «있는데» 칠한 색이 «빈» 판」은 «못 쟀다»로 «말한다».
  if (adherence === null || typeof adherence !== 'object') {
    const declared = top.declaredValues;
    const painted = top.paintedCount;
    if (typeof declared === 'number' && declared > 0 && painted === 0) {
      return [{
        kind: 'off-token-color',
        where: 'color',
        detail: '칠한 색을 «못 읽었다» — 「이탈 0」이 아니라 «이 판에서 못 쟀다»',
      }];
    }
    return [];
  }
  const off = (adherence as Record<string, unknown>).offToken;
  if (!Array.isArray(off) || off.length === 0) return [];
  const names = off
    .filter((c): c is { value: string; count: number } =>
      c !== null && typeof c === 'object'
      && typeof (c as { value?: unknown }).value === 'string'
      && typeof (c as { count?: unknown }).count === 'number')
    .map((c) => `${c.value}(${c.count}회)`);
  if (names.length === 0) return [];
  return [{
    kind: 'off-token-color',
    where: 'color',
    // ⭐ 값과 횟수를 «그대로» 낸다 — 수만 내면 고칠 수 없다.
    detail: `칠한 색이 «토큰 밖»이다 — ${names.slice(0, 5).join(' · ')}`,
  }];
}

/**
 * ⭐⭐ ***③ 칸의 자*** — 「칠한 «크기»가 «선언된 사다리»에서 왔나」.
 *
 * ⛔⭐ 씨앗과 «안» 댄다 — 씨앗과 대면 그것은 ②재현이다. ***자기 선언 ↔ 자기 화면***이라
 *    ***컨셉이 달라도 성립한다.***
 * ⛔ `ladder` 가 `null` 이면 «못 쟀다»이고 ***경고를 안 낸다*** — 그러나 그것을 「깨끗」으로 읽지 않게
 *    `tallyKinds` 의 「안 걸린 갈래」가 그 사실을 «스스로» 말한다.
 */
export function findingsFromLadder(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  const ladder = top.ladder;
  // ⛔⭐ `findingsFromSpace` 와 «같은 이유» — 「못 쟀다」를 「이탈 0」으로 흘리지 않는다.
  if (ladder === null || typeof ladder !== 'object') {
    const declared = top.declaredLadder;
    const painted = top.painted;
    if (Array.isArray(declared) && declared.length > 0 && Array.isArray(painted) && painted.length === 0) {
      return [{
        kind: 'off-ladder-size',
        where: 'type',
        detail: '칠한 크기를 «못 읽었다» — 「이탈 0」이 아니라 «이 판에서 못 쟀다»',
      }];
    }
    return [];
  }
  const off = (ladder as Record<string, unknown>).offLadder;
  if (!Array.isArray(off) || off.length === 0) return [];
  const names = off
    .filter((u): u is { px: number; count: number } =>
      u !== null && typeof u === 'object'
      && typeof (u as { px?: unknown }).px === 'number'
      && typeof (u as { count?: unknown }).count === 'number')
    .map((u) => `${u.px}px(${u.count}회)`);
  if (names.length === 0) return [];
  return [{
    kind: 'off-ladder-size',
    where: 'type',
    // ⭐ 값과 횟수를 «그대로» — 수만 내면 고칠 수 없다.
    detail: `칠한 크기가 «선언한 사다리 밖»이다 — ${names.slice(0, 5).join(' · ')}`,
  }];
}

/**
 * ⭐⭐ ***③ 칸의 «셋째» 축*** — 「띄운 «간격»이 «선언한 눈금»에서 왔나」.
 *
 * ⛔ 눈금이 «없거나» 띄운 간격이 셋 미만이면 판정 함수가 `null`/`discriminating:false` 를 내고,
 *    그때는 ***경고를 안 낸다*** — 「깨끗」이 아니라 «안 재고 있다»이다.
 * 🩸 이 자가 처음 잡은 것은 ***브라우저 기본 `p { margin: 1em 0 }`*** 였다 —
 *    «활자» 사다리 값이 «간격»으로 흘러든 것이다(상속이 끊긴 기본값 계열).
 */
export function findingsFromSpace(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  const rep = top.spaceLadder;
  // ⛔⭐⭐ 🩸 2026-09-12 실측 — ***전수에서 「이탈 4 → 0」이 나왔는데 «개선이 아니었다».***
  //    같은 사이트를 단건으로 다시 재니 ***15px×10 이 그대로 있었다.***
  //    기전: 판정 함수는 「눈금이 없거나 띄운 간격을 못 읽으면」 `null` 을 내고,
  //          이 자는 그 `null` 을 ***「이탈 0」과 «똑같이» 조용히*** 넘겼다.
  // ⇒ ✅ ***「선언은 있는데 띄운 간격이 «빈» 경우」는 «못 쟀다»로 «말한다».***
  //    ⛔ 이 창이 스무 번 적은 그 모양을 ***내 배선이 또 냈다.***
  if (rep === null || typeof rep !== 'object') {
    const declared = top.declaredLadder;
    const painted = top.painted;
    if (Array.isArray(declared) && declared.length > 0 && Array.isArray(painted) && painted.length === 0) {
      return [{
        kind: 'off-scale-space',
        where: 'space',
        detail: '띄운 간격을 «못 읽었다» — 「이탈 0」이 아니라 «이 판에서 못 쟀다»',
      }];
    }
    return [];
  }
  const r = rep as Record<string, unknown>;
  if (r.discriminating !== true) return [];
  const off = r.offLadder;
  if (!Array.isArray(off) || off.length === 0) return [];
  const names = off
    .filter((u): u is { px: number; count: number } =>
      u !== null && typeof u === 'object'
      && typeof (u as { px?: unknown }).px === 'number'
      && typeof (u as { count?: unknown }).count === 'number')
    .map((u) => `${u.px}px(${u.count}회)`);
  if (names.length === 0) return [];
  return [{
    kind: 'off-scale-space',
    where: 'space',
    detail: `띄운 간격이 «선언한 눈금 밖»이다 — ${names.slice(0, 5).join(' · ')}`,
  }];
}

/**
 * ⭐⭐ ***③ 칸의 «넷째» 축*** — 「쓴 «곡선·지속»이 «선언한 토큰»에서 왔나」.
 *
 * ⛔⭐ 지속시간 축은 ***판정 함수가 스스로 「못 쟀다」를 낸다***(강제 reduced-motion · 선언 0칸).
 *    그때는 `offTokenDurations` 가 «빈 목록»이라 ***이 자가 자동으로 조용해진다.***
 * ⛔ 곡선이 셋 미만이면 `discriminating:false` — 그래도 ***이탈은 «낸다»***(곡선은 강제에 안 지워진다).
 */
export function findingsFromMotion(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  const rep = top.motion;
  // ⛔⭐ 색·활자·간격 축과 «같은 구멍»을 여기서도 막는다 — 「못 쟀다」를 「이탈 0」으로 흘리지 않는다.
  if (rep === null || typeof rep !== 'object') {
    const declared = top.declaredEasings;
    const used = top.usedEasings;
    if (Array.isArray(declared) && declared.length > 0 && Array.isArray(used) && used.length === 0) {
      return [{
        kind: 'off-token-motion',
        where: 'motion',
        detail: '쓴 곡선을 «못 읽었다» — 「이탈 0」이 아니라 «이 판에서 못 쟀다»',
      }];
    }
    return [];
  }
  const r = rep as Record<string, unknown>;
  const pull = (key: string): string[] => {
    const list = r[key];
    if (!Array.isArray(list)) return [];
    return list
      .filter((e): e is { value: string; count: number } =>
        e !== null && typeof e === 'object'
        && typeof (e as { value?: unknown }).value === 'string'
        && typeof (e as { count?: unknown }).count === 'number')
      .map((e) => `${e.value}(${e.count}회)`);
  };
  const names = [...pull('offTokenEasings'), ...pull('offTokenDurations')];
  if (names.length === 0) return [];
  return [{
    kind: 'off-token-motion',
    where: 'motion',
    detail: `쓴 곡선·지속이 «토큰 밖»이다 — ${names.slice(0, 4).join(' · ')}`,
  }];
}

/**
 * ⭐⭐ ***③ 칸의 자 ②*** — 「바탕 «하나»에서만 사는데 이름이 그것을 «안 말하는» 색」.
 *
 * ⛔⭐ ***`fragile` 이 아니라 `undeclared` 를 본다*** — 제약이 있는 것은 결함이 아니고,
 *    ***그것을 «안 말하는» 것***이 결함이다(📏 대조 ①②가 그 한 변수에서 갈렸다).
 * ⛔ 바탕이 셋 미만이면 판정 함수가 `discriminating: false` 를 내고, 그때는 ***경고를 안 낸다***
 *    — 「깨끗」이 아니라 «변별 안 함»이다.
 */
export function findingsFromPairs(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  const pairs = top.pairs;
  // ⛔⭐ 같은 구멍 — 색 토큰이 «있는데» 판정이 없으면 «못 쟀다»다.
  if (pairs === null || typeof pairs !== 'object') {
    const colors = top.colors;
    if (typeof colors === 'number' && colors > 0) {
      return [{
        kind: 'undeclared-pair-token',
        where: 'color',
        detail: '쌍 유효성을 «못 쟀다» — 「취약 0」이 아니라 «이 판에서 못 쟀다»',
      }];
    }
    return [];
  }
  const p = pairs as Record<string, unknown>;
  // ⛔ 분모가 모자라면 «아무 말도 하지 않는다».
  if (p.discriminating !== true) return [];
  const undeclared = p.undeclared;
  if (!Array.isArray(undeclared) || undeclared.length === 0) return [];
  const names = undeclared
    .filter((r): r is { name: string; readableOn: string[] } =>
      r !== null && typeof r === 'object'
      && typeof (r as { name?: unknown }).name === 'string'
      && Array.isArray((r as { readableOn?: unknown }).readableOn))
    .map((r) => `${r.name}(오직 ${r.readableOn[0] ?? '?'})`);
  if (names.length === 0) return [];
  return [{
    kind: 'undeclared-pair-token',
    where: 'color',
    detail: `바탕 «하나»에서만 사는데 이름이 «안 말한다» — ${names.slice(0, 5).join(' · ')}`,
  }];
}

/**
 * ⭐ 「없는 역할」을 «관측»으로 낸다 — 경고가 «아니다».
 * ⛔ `missing` 을 «못 잰» 산출은 빈 목록이다(「전부 있다」가 아니다 — 부르는 쪽이 가른다).
 */
/**
 * ⭐⭐ ***「브라우저 «기본값»이 살아 있는 자리」를 «관측»으로 낸다.***
 *
 * ⛔⭐ ***경고가 «아니다».*** 기본값을 남겨 둔 것이 «의도»일 수 있고,
 *    갈래 표(`ALL_FINDING_KINDS`)에 넣으면 ***「경고 수」가 뜻을 잃는다.***
 * 🩸 이 창에서 이 계급의 사고가 ***다섯 번*** 났다(색 1 · 간격 4) —
 *    그래서 「세는 자리」는 있어야 하되 ***「경고」는 아니어야 한다.***
 */
export function observationsFromUaDefaults(raw: unknown): readonly string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const rep = (raw as Record<string, unknown>).uaDefaults;
  if (rep === null || typeof rep !== 'object') return [];
  const leaked = (rep as Record<string, unknown>).leaked;
  if (!Array.isArray(leaked) || leaked.length === 0) return [];
  const names = leaked
    .filter((l): l is { tag: string; marginPx: number; count: number; emRatio: number } =>
      l !== null && typeof l === 'object'
      && typeof (l as { tag?: unknown }).tag === 'string'
      && typeof (l as { marginPx?: unknown }).marginPx === 'number'
      && typeof (l as { count?: unknown }).count === 'number')
    .map((l) => `${l.tag} ${l.marginPx}px×${l.count}`);
  if (names.length === 0) return [];
  return [`기본값이 «살아 있다»(마진): ${names.slice(0, 6).join(' · ')} — ⚠️ 의도일 수 있다`];
}

/**
 * ⭐⭐ ***「선언은 했는데 이 장이 «안 쓴» 사다리 칸」을 «관측»으로 낸다.***
 *
 * ⛔⭐ ***경고가 «아니다»*** — 「밖을 밟았나」(`off-ladder-size`)와 ***다른 축***이다.
 *    「안 쓴 칸」은 ***이탈이 0인데도*** 생긴다(2026-09-12 `containment` 로 가른 그 갈림).
 * 🩸 왜 생겼나([S] 의 «다섯째 형태» · 2026-09-12): 이 관측은 `check-concept` 입구에는 «있었는데»
 *    ***이 스윕 입구에는 «고치기 전부터» 없었다*** — ⛔ 「내가 부순 것」이 아니라 ***「내가 안 본 것」***이다.
 *    ⇒ ***고치기 «전»에 「이 관을 무엇이 나르나」를 본다.*** 여기 통로는 `observations` 다(경고가 아니다).
 */
export function observationsFromUnusedRungs(raw: unknown, axis: '활자' | '간격'): readonly string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const key = axis === '활자' ? 'unusedRungs' : 'unusedSteps';
  // 📏 실측 2026-09-12(⛔ 첫 판은 «추측»으로 `typeLadder` 라 썼다 — 실제 키는 `ladder` 다):
  //    활자 산출  { url, tokenFiles, declaredLadder, painted, ***ladder***{ …, unusedRungs } }
  //    간격 산출  { url, tokenFiles, declaredLadder, painted, ***spaceLadder***{ …, unusedSteps } }
  const rep = (raw as Record<string, unknown>)[axis === '활자' ? 'ladder' : 'spaceLadder'];
  if (rep === null || typeof rep !== 'object') return [];
  const unused = (rep as Record<string, unknown>)[key];
  if (!Array.isArray(unused) || unused.length === 0) return [];
  const px = unused.filter((n): n is number => typeof n === 'number');
  if (px.length === 0) return [];
  return [`${axis} 사다리에서 이 장이 «안 쓴» 칸: ${px.join('px · ')}px`
    + ' — ⛔ «이탈이 아니다». 다른 장을 재거나 사다리를 줄여라'];
}

export function observationsFromComputed(raw: unknown): readonly string[] {
  if (raw === null || typeof raw !== 'object') return [];
  const missing = (raw as Record<string, unknown>).missing;
  if (!Array.isArray(missing)) return [];
  const roles = [...new Set(missing.filter((r): r is string => typeof r === 'string'))];
  // ⛔⭐⭐ 🩸 2026-09-12([S] 의 ⑥ · 「⚠️ 줄을 세어 한 줄씩 답을 적어라」로 찾았다) —
  //    첫 문면은 ***「역할이 «없다»」***였고, 그것이 ***결손처럼 읽혔다.***
  //    📏 실측: 이 줄이 전수 13 사이트 중 ***12***에서 떴는데, 두 화면을 직접 보니 `<button>` 이
  //    ***정말 0개***였다 — ***그 사이트들은 링크로 짓는다.*** ⇒ ***결함이 아니라 「안 쓴다」다.***
  //    ⛔ 오늘 사다리 축에서 고친 ***「이탈 ↔ 안 씀」과 «같은 병»***이 여기 세 번째로 있었다.
  return roles.length === 0 ? [] : [`이 장이 «안 쓰는» 역할: ${roles.join(' · ')}`
    + ' — ⛔ «결함이 아니다». 링크로 짓는 사이트에는 정상이다; 「있어야 하는데 없다」면 선택자를 넓혀라'];
}

/**
 * `check-affordances --json` 산출에서 「기계에게 침묵인가」를 뽑는다.
 *
 * ⛔⭐⭐ 판정은 ***「화면으론 «지금 어느 것»을 보여 주는데 기계엔 안 알린다」 «하나»***다.
 * 🩸 앞선 «두» 판이 둘 다 ***상호작용이 «적은» 페이지를 벌했다***:
 *    ① 「`[role]` 이 0 이면 침묵」 — 시맨틱을 «잘» 쓴 페이지를 벌했다
 *    ② 「상태 신호가 0 이면 침묵」 — 레퍼런스는 누를 것이 43~59개, 자작은 1~22개다
 * 📏 양성/음성 대조를 «직접 만들어» 갈랐다:
 *    시각 선택 ⊕ aria «없음» → 잡는다 · 시각 선택 ⊕ aria «있음» → 놓아준다 ·
 *    선택이 «없는» 화면 → 벌하지 «않는다».
 * ⛔ `health` 가 없으면 «못 쟀음»이다 — 「침묵 아님」으로 접지 않는다.
 */
export function findingsFromAffordances(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const health = (raw as Record<string, unknown>).health;
  // ⛔⭐⭐ 다른 다섯 축과 «같은 구멍» — 「못 쟀다」를 「0」과 «똑같이» 조용히 넘기던 자리다.
  //    ⛔ 여기선 «한 갈래»가 아니라 «여러 갈래»가 함께 죽으므로, 대표로 `silent-to-machines` 가 말한다.
  // ⛔⭐ ***「칸이 «아예 없다»」와 「칸이 «null 이다»」를 «가른다»*** —
  //    앞은 «옛 산출»일 수 있으므로 ***지어내지 않고 조용히*** 넘긴다(기존 시험이 그것을 문다).
  if (health === null) {
    return [{
      kind: 'silent-to-machines',
      where: 'affordance',
      detail: '어포던스를 «못 쟀다» — 「0」이 아니라 «이 판에서 못 쟀다»(역할·상태 신호 축이 함께 빠졌다)',
    }];
  }
  if (typeof health !== 'object') return [];
  const h = health as Record<string, unknown>;
  const out: HealthFinding[] = [];

  // ⛔⭐ 「글자가 읽히나」 — `silent-to-machines` 와 «다른 축»이다(기계가 아니라 «사람»이 못 읽는다).
  //    📏 실측(2026-09-12): 자작 13개가 801곳 중 145곳(18.1%) · airbnb 는 0곳 · netflix 는 11%.
  const contrast = (raw as Record<string, unknown>).contrast;
  if (contrast !== null && typeof contrast === 'object') {
    const c = contrast as Record<string, unknown>;
    const failed = typeof c.failed === 'number' ? c.failed : 0;
    const measured = typeof c.measured === 'number' ? c.measured : 0;
    // ⛔⭐ 🩸 ***「잰 자리가 0곳」은 「전부 읽힌다」가 «아니다»*** — 그 판에서 글자를 «하나도» 못 읽은 것이다.
    //    (이 축이 이 창에서 ***801곳 중 145곳***을 잡았다 — 조용히 0 이 되면 그만큼을 잃는다.)
    if (measured === 0) {
      out.push({
        kind: 'text-unreadable',
        where: 'contrast',
        detail: '글자 대비를 «못 쟀다» — 「전부 읽힌다」가 아니라 «이 판에서 잰 자리가 0곳»이다',
      });
    }
    if (failed > 0 && measured > 0) {
      const worst = Array.isArray(c.worst) ? c.worst : [];
      const first = worst.find((w): w is { detail: string } =>
        w !== null && typeof w === 'object' && typeof (w as { detail?: unknown }).detail === 'string');
      out.push({
        kind: 'text-unreadable',
        where: 'contrast',
        // ⛔ 「수」가 아니라 «가장 나쁜 자리»를 같이 낸다 — 고칠 순서가 그것이다.
        detail: `잰 자리 ${measured}곳 중 ${failed}곳(${Math.round((failed / measured) * 100)}%)이 «안 읽힌다»`
          + (first ? ` — 최악 ${first.detail}` : ''),
      });
    }
  }

  if (h.silentToMachines !== true) return out;
  const interactive = typeof h.interactive === 'number' ? h.interactive : null;
  void interactive;
  out.push({
    kind: 'silent-to-machines',
    where: 'aria',
    detail: `화면으론 «지금 어느 것»을 보여 주는데 기계엔 안 알린다`
      + ` (형제 중 «혼자만» 다르게 칠해진 누를 것에 aria-current·pressed·selected 가 없다`
      + `${typeof h.visualSelectionWithoutAria === 'number' ? ` · ${h.visualSelectionWithoutAria}무리` : ''})`,
  });
  return out;
}

/** `measure-fidelity --json` 산출에서 픽셀 축 경고를 뽑는다. */
export function findingsFromFidelity(raw: unknown): readonly HealthFinding[] {
  if (raw === null || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const out: HealthFinding[] = [];

  // ⛔⭐ 이 칸은 `pixelTrustworthy` 와 «다른 축»이다 — 「못 믿는다」가 아니라 「나쁘다」다.
  //    🩸 `spotify` 는 `pixelTrustworthy ✅` 였는데 ***미러가 거의 안 그려져 있었다***.
  //    ⚠️ 「더 칠했다」는 결함으로 세지 않는다(덮개를 지웠거나 lazy 가 펼쳐졌다).
  // ⛔⭐⭐ 🩸 ***아홉 번째 구멍*** — 사다리 ㉞(「한 자리를 고쳤으면 옆 축을 전수로 세라」)를 쓴 «3분 뒤»에 찾았다.
  //    `paintCoverage` 의 기본값이 ***`'unmeasured'`*** 인데 이 자는 그것을 ***「맞는다」와 «같은 묶음»으로*** 조용히 넘겼다
  //    (기존 시험이 그 «결정»을 명시적으로 물고 있었다 — 옛 창이 «알고» 고른 것이다).
  // ⇒ ✅ 그러나 「못 쟀다」는 «말해야» 한다. ⛔ 다만 ***`mirror-under-painted` 로 내면 「덜 칠했다」와 «섞인다»*** ⇒
  //    ***`pixel-untrustworthy`(= 「픽셀 축을 못 믿는다」)로 낸다*** — 그 갈래의 뜻이 바로 그것이다.
  if (o.paintCoverageVerdict === 'unmeasured') {
    out.push({
      kind: 'pixel-untrustworthy',
      where: 'paint',
      detail: typeof o.paintCoverageDetail === 'string'
        ? `칠한 넓이를 «못 쟀다» — ${o.paintCoverageDetail}`
        : '칠한 넓이를 «못 쟀다» — 「덜 칠하지 않았다」가 아니라 «이 판에서 못 쟀다»',
    });
  }

  if (o.paintCoverageVerdict === 'mirror-under-painted') {
    out.push({
      kind: 'mirror-under-painted',
      where: 'paint',
      detail: typeof o.paintCoverageDetail === 'string' ? o.paintCoverageDetail : '사본이 원본보다 «덜» 칠했다',
    });
  }

  if (o.pixelTrustworthy !== false) return out;
  // ⛔ 「왜 못 믿나」를 «이름으로» 댄다 — 사유를 안 대면 고칠 수가 없다(`#17442` 가 그 결함이었다).
  const reasons: string[] = [];
  if (o.captureSettlingTimedOut === true) reasons.push('캡처 정착');
  if (o.originalNearBlankCapture === 'near-blank' || o.mirrorNearBlankCapture === 'near-blank') reasons.push('근접 공백');
  if (o.nearBlankClassificationReliable === false) reasons.push('공백 분류 미신뢰');
  if (o.croppedToViewport === false) reasons.push('뷰포트 크롭 아님');
  out.push({
    kind: 'pixel-untrustworthy',
    where: 'pixel',
    detail: reasons.length ? `픽셀 미신뢰 — ${reasons.join(' · ')}` : '픽셀 미신뢰 — ⚠️ 사유를 «못 읽었다»',
  });
  return out;
}

/** 두 판을 대 본 결과. ⭐ 이것이 「루프」의 본체다 — 고친 뒤 «줄었나»를 말한다. */
export interface HealthDelta {
  readonly site: string;
  readonly fixed: readonly HealthFinding[];
  readonly appeared: readonly HealthFinding[];
  readonly remaining: number;
  /**
   * ⛔⭐ 한쪽이라도 «못 쟀으면» 증감을 말하지 않는다 —
   *    ***못 잰 판과 대면 「전부 고쳤다」가 나온다***(이 저장소의 「0과 못 쟀음」 불변식).
   */
  readonly comparable: boolean;
}

// ⛔ 같은 갈래라도 «다른 장»에서 난 것은 다른 경고다 — 접으면 「고쳤다」가 거짓이 된다.
const key = (f: HealthFinding) => `${f.kind} ${f.where} ${f.page ?? ''}`;

export function compareHealth(before: SiteHealth, after: SiteHealth): HealthDelta {
  if (!before.measured || !after.measured) {
    return { site: after.site, fixed: [], appeared: [], remaining: after.findings.length, comparable: false };
  }
  const beforeKeys = new Set(before.findings.map(key));
  const afterKeys = new Set(after.findings.map(key));
  return {
    site: after.site,
    fixed: before.findings.filter((f) => !afterKeys.has(key(f))),
    appeared: after.findings.filter((f) => !beforeKeys.has(key(f))),
    remaining: after.findings.length,
    comparable: true,
  };
}

/**
 * ⛔ 이 자가 «낼 수 있는» 갈래 전부. 적중 0 인 갈래를 세려면 «분모»가 필요하다.
 * ⭐ 새 갈래를 더하면 ***여기에도 더한다*** — 안 그러면 그 갈래는 「0건」 목록에 영영 안 뜬다.
 */
export const ALL_FINDING_KINDS: readonly HealthFinding['kind'][] = [
  'typography-hierarchy', 'heading-level-skip', 'role-unrepresentative',
  'painted-unreadable', 'pixel-untrustworthy', 'mirror-under-painted',
  'off-token-color', 'off-ladder-size', 'off-scale-space', 'off-token-motion', 'undeclared-pair-token',
  'silent-to-machines', 'text-unreadable',
];

/**
 * ⭐⭐ 갈래별 적중 수 ⊕ ***한 번도 «안 걸린» 갈래***.
 *
 * ⛔⭐ 🩸 2026-09-11 — ***여덟 갈래 중 셋만 걸리고 있었고, 그중 하나는 «완전히 죽어» 있었다***
 *    (`role-unrepresentative` · 152 표본 0건 · 원인은 필드 «이름»이었다).
 *    ⇒ 그때는 «손으로» 세어 알았다. ***도구가 스스로 내게 한다.***
 * ⛔ ***「0건」은 「깨끗하다」가 «아니라» 「안 재고 있다」일 수 있다*** — 그 말을 표가 «직접» 한다.
 */
export function tallyKinds(rows: readonly SiteHealth[]): {
  readonly hits: ReadonlyArray<readonly [HealthFinding['kind'], number]>;
  readonly never: readonly HealthFinding['kind'][];
} {
  const counts = new Map<HealthFinding['kind'], number>(ALL_FINDING_KINDS.map((k) => [k, 0]));
  for (const row of rows) {
    // ⛔ 못 잰 사이트의 경고는 «없다» — 그것을 0 으로 세지 않는다(애초에 findings 가 비어 있다).
    for (const f of row.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  const hits = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return { hits, never: ALL_FINDING_KINDS.filter((k) => (counts.get(k) ?? 0) === 0) };
}

/** 표 한 장. ⛔ 「못 쟀음」을 «별도 칸»으로 낸다. */
export function renderHealthTable(rows: readonly SiteHealth[]): string[] {
  const lines: string[] = [];
  const width = Math.max(4, ...rows.map((r) => r.site.length));
  lines.push(`${'사이트'.padEnd(width)}  경고    본 장  갈래`);
  for (const r of rows) {
    if (!r.measured) {
      lines.push(`${r.site.padEnd(width)}  ⚪ 못 쟀다 — ${r.unmeasuredReason ?? '사유 없음'}`);
      continue;
    }
    const kinds = [...new Set(r.findings.map((f) => f.kind))].join(' · ') || '—';
    // ⛔ 「몇 장을 봤나」를 «값으로» 낸다 — 한 장짜리 판정을 사이트의 사실로 읽지 않게.
    const pages = r.pagesSeen === undefined ? '⚪' : `${r.pagesSeen}장`;
    lines.push(`${r.site.padEnd(width)}  ${String(r.findings.length).padStart(3)}  ${pages.padStart(4)}  ${kinds}`);
    // ⛔ 관측은 «경고 수»에 안 들어가지만 «사라지지도» 않는다.
    for (const note of r.observations ?? []) lines.push(`${' '.repeat(width)}       ⚪ ${note}`);
  }
  const measured = rows.filter((r) => r.measured);
  const total = measured.reduce((n, r) => n + r.findings.length, 0);
  lines.push('');
  // ⛔ 분모를 «잰 것»으로 적는다 — 못 잰 것을 분모에 넣으면 평균이 «좋아진다».
  lines.push(`잰 사이트 ${measured.length}/${rows.length} · 경고 합계 ${total}${measured.length < rows.length ? `  ⚠️ 못 잰 ${rows.length - measured.length}개는 분모에 «없다»` : ''}`);

  // ⛔⭐ 갈래별 적중 ⊕ 「한 번도 안 걸린 갈래」 — 「0건」을 「깨끗」으로 읽지 않게 «표가 직접» 말한다.
  const tally = tallyKinds(rows);
  if (tally.hits.length > 0) {
    lines.push('');
    lines.push('── 갈래별 적중 ──');
    for (const [kind, n] of tally.hits) lines.push(`  ${kind.padEnd(22)} ${n}`);
  }
  if (tally.never.length > 0) {
    lines.push(`  ⚪ 한 번도 «안 걸린» 갈래 ${tally.never.length}: ${tally.never.join(' · ')}`);
    lines.push('     ⛔ 「깨끗하다」가 아니라 «안 재고 있다»일 수 있다 — 갈래마다 「왜 0인가」를 적어라');
  }
  // ⛔ 「이 자가 못 보는 것」을 «값으로» 낸다 — 0건을 「없다」로 읽지 않게.
  lines.push('');
  lines.push('⛔ 이 자가 «못 보는» 것:');
  for (const spot of SITE_HEALTH_BLIND_SPOTS) lines.push(`    · ${spot}`);
  return lines;
}
