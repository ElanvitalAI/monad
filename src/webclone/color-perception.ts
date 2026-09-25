/**
 * color-perception.ts — ***「눈이 같다고 보는 색」을 하나로 접는다.***
 *
 * ⛔ 왜 있나 (52차 이월 · `#16789` §후속):
 *    `rgba(60,60,60,.7)` 과 `rgba(60,60,60,.33)` 이 «따로» 잡힌다.
 *    씨앗의 팔레트가 «같은 색의 여러 투명도»로 부풀어 「99색」 같은 수가 나온다.
 *    ⇒ 그 수는 참이지만 ***디자인 결정의 수가 아니다***.
 *
 * ⛔⭐ 그런데 「접는다」는 위험하다 — 잘못 접으면 «다른 색»이 사라진다.
 *    그래서 규율 셋:
 *      ⓐ 접은 것을 «말한다» — 대표값 옆에 「N색을 접었다」와 그 목록
 *      ⓑ 대표는 «가장 많이 쓰인» 쪽 — 평균을 내면 «아무 데도 없는 색»이 나온다
 *      ⓒ 임계는 «값으로» 나간다 — 왜 접혔는지 읽는 쪽이 다시 잴 수 있게
 *
 * ⛔⭐⭐ 2026-09-10 정정 — ***이 파일의 머리말이 든 «바로 그 예»가 틀렸다.***
 *    옛 규칙: 「같은 RGB · 다른 알파」는 «무조건» 접는다.
 *    📏 실측: `rgba(60,60,60,.7)` 은 흰 배경 위에서 `rgb(119,119,119)`,
 *            `rgba(60,60,60,.33)` 은 `rgb(191,191,191)` — ***ΔE 27.3*** (JND 2.3 의 «11.9배»).
 *    🔑 ***그 규칙은 「CSS 문면이 같다」는 «참인» 말이고, 이 모듈의 축인 「눈」에는 «아무 말도 안 한다».***
 *    ✅ ⇒ 알파는 ***배경 위에 합성한 «뒤»에*** 잰다. 배경을 모르면 ***접지 않는다***
 *       (⛔ 「몰라서 접었다」는 「접어도 된다」가 아니다).
 */

export interface ColorCount {
  readonly value: string;
  readonly count: number;
}

export interface MergedColor {
  readonly value: string;
  readonly count: number;
  /** ⭐ 이 대표로 접힌 «다른» 문면들. 빈 배열이면 안 접혔다. */
  readonly merged: readonly string[];
  /** 접힌 이유 — `alpha`(같은 RGB·다른 투명도) 또는 `near`(지각 거리) */
  readonly reason: 'none' | 'alpha' | 'near' | 'alpha+near';
  /** ⭐ 배경 위에 «합성한» 값. 배경을 안 줬거나 불투명이면 `undefined`. */
  readonly composited?: string;
}

/**
 * ⭐ 배경 위 알파 합성 — `C = α·전경 + (1-α)·배경`.
 * ⛔ 배경 자체가 투명하면 «못 합성한다» — `null` 을 낸다(흰색으로 «몰지» 않는다).
 * ⛔ 이것은 «한 겹»이다 — 실제 화면은 여러 겹이 쌓인다(아래 한계 참조).
 */
export function compositeOver(foreground: string, background: string): string | null {
  const f = parseRgb(foreground);
  const b = parseRgb(background);
  if (!f || !b) return null;
  if (b.a < 1) return null;   // ⛔ 배경을 모르는 것과 같다
  if (f.a >= 1) return `rgb(${Math.round(f.r)}, ${Math.round(f.g)}, ${Math.round(f.b)})`;
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`;
}

/** ⛔ 배경을 모르면 알파 색을 «못 접는다» — 그 사실을 값으로 낸다. */
export const ALPHA_NEEDS_BACKGROUND =
  '배경을 안 줘서 «투명한 색»은 접지 않았다 — 같은 RGB 라도 알파가 다르면 눈에는 «다른 색»이다';

/** ⛔ 못 읽으면 `null` — 검정(0,0,0)으로 «몰지» 않는다. */
export function parseRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]);
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
    return { r, g, b, a };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** sRGB → CIELAB (D65). ⛔ 근사가 아니라 표준 변환이다 — 「가깝다」의 기준이 재현 가능해야 한다. */
export function toLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 ΔE. ⛔ 못 읽은 색은 `null` — 「거리 0」이 «아니다». */
export function deltaE(x: string, y: string): number | null {
  const p = parseRgb(x);
  const q = parseRgb(y);
  if (!p || !q) return null;
  const A = toLab(p.r, p.g, p.b);
  const B = toLab(q.r, q.g, q.b);
  return Math.sqrt((A.L - B.L) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
}

/**
 * ⭐ 기본 임계 **2.3** — CIE76 에서 「훈련받지 않은 눈이 겨우 구별하는 차이(JND)」로 널리 쓰이는 값.
 * ⛔ 이것은 «선택»이다 — 값으로 내보내 읽는 쪽이 다시 잴 수 있게 한다.
 */
export const DEFAULT_DELTA_E = 2.3;

/**
 * 지각적으로 «같은» 색을 접는다.
 * ⛔ 접은 것을 «말한다» — `merged` 목록과 `reason` 이 결과에 남는다.
 * ⛔ 못 읽은 문면은 «접지 않는다» — 그대로 남기고 `reason: 'none'` 이다.
 */
export function mergePerceptualDuplicates(
  colors: readonly ColorCount[],
  thresholdDeltaE = DEFAULT_DELTA_E,
  /** ⭐ 페이지의 «바탕». 주면 알파를 합성한 뒤 잰다. 안 주면 투명한 색은 «안 접는다». */
  background?: string,
): MergedColor[] {
  const out: MergedColor[] = [];
  // ⛔⭐ 「눈이 보는 값」을 «먼저» 만든다 — 접는 판단은 «전부» 이 값으로 한다.
  //    못 만들면 `null` 이고, `null` 은 ***누구와도 안 접힌다***(모르는 것을 같다고 하지 않는다).
  const effectiveOf = (value: string): string | null => {
    const parsed = parseRgb(value);
    if (!parsed) return null;
    if (parsed.a >= 1) return value;
    if (background === undefined) return null;   // ⛔ 배경을 모르면 «못 잰다»
    return compositeOver(value, background);
  };
  const heads: Array<string | null> = [];
  for (const item of [...colors].sort((a, b) => b.count - a.count)) {
    const parsed = parseRgb(item.value);
    const effective = effectiveOf(item.value);
    let placed = false;
    if (parsed && effective !== null) {
      for (let i = 0; i < out.length; i += 1) {
        const headEffective = heads[i];
        if (headEffective === null || headEffective === undefined) continue;
        const distance = deltaE(headEffective, effective);
        if (distance === null || distance > thresholdDeltaE) continue;
        const other = parseRgb(out[i].value);
        // 「같은 RGB · 다른 알파」는 이유를 `alpha` 로 적는다 — ⛔ 단 «접을지»는 위 ΔE 가 정했다.
        const sameRgb = other !== null
          && other.r === parsed.r && other.g === parsed.g && other.b === parsed.b
          && other.a !== parsed.a;
        const reason: MergedColor['reason'] = sameRgb ? 'alpha' : 'near';
        const head = out[i];
        out[i] = {
          ...head,
          count: head.count + item.count,
          merged: [...head.merged, item.value],
          // ⛔ 접은 이유가 «섞이면» 둘 다 적는다 — 하나로 접으면 왜 접혔는지 잃는다
          reason: head.reason === 'none' || head.reason === reason ? reason
            : head.reason.includes('alpha') && reason.includes('near') ? 'alpha+near'
              : head.reason.includes('near') && reason.includes('alpha') ? 'alpha+near' : head.reason,
        };
        placed = true;
        break;
      }
    }
    if (!placed) {
      const composited = effective !== null && effective !== item.value ? effective : undefined;
      out.push({ value: item.value, count: item.count, merged: [], reason: 'none', composited });
      heads.push(effective);
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/** ⛔ 배경을 몰라 «못 합성한» 색의 수. 0 이 아니면 위 목록은 «부풀어 있다». */
export function countUncomposited(colors: readonly ColorCount[], background?: string): number {
  if (background !== undefined) return 0;
  return colors.filter((c) => {
    const p = parseRgb(c.value);
    return p !== null && p.a < 1;
  }).length;
}

/**
 * 사람이 읽을 줄. ⛔ 접힌 것이 «보이게» 낸다.
 * ⛔⭐ 기존 문면(`값 (백분율 · N/total개 요소)`)을 «지키고» 접음 정보만 «덧붙인다» —
 *    형식을 바꾸면 그 줄을 읽던 시험·파서가 조용히 끊긴다(정보 손실).
 */
export function formatMergedColor(color: MergedColor, total: number): string {
  // ⭐ 합성값이 있으면 «눈이 보는 값»을 같이 낸다 — CSS 문면만으로는 화면을 못 그린다.
  const shown = color.composited === undefined ? color.value : `${color.value} → ${color.composited}(합성)`;
  const head = total > 0
    ? `${shown} (${((color.count / total) * 100).toFixed(1)}% · ${color.count}/${total}개 요소)`
    : `${shown} (${color.count}회)`;
  if (color.merged.length === 0) return head;
  return `${head} · ⊕ ${color.merged.length}색 접음(${color.reason}): ${color.merged.join(', ')}`;
}
