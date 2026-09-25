/**
 * 🧾 상품 접지 «체크리스트» — ⛔ 사이트별 분기가 아니라 «어느 사이트든 통과해야 하는 계약»이다.
 *
 * 대표 2026-09-10: *"앞으로 여러 사이트가 생길수 있어서 건별이 아니라 체크리스트 확인이 되야겠네요"*
 *
 * ⛔ 왜 「사이트별 어댑터」로 안 가나 —
 *   어댑터를 늘리면 «새 사이트를 만날 때마다 코드를 짓는» 일이 된다. 그러면
 *   ①무엇이 빠졌는지 말해 주는 자가 없고 ②어댑터가 늙어도 «조용히» 늙는다.
 *   ⇒ 대신 ***「무엇을 얻어야 하는가」를 한 곳에 두고, 페이지가 그것을 냈는지 «잰다»***.
 *   새 사이트 추가 = 「체크리스트가 이름을 댄 빈 칸」을 메우는 일이 된다.
 *
 * ⛔⛔ 이 파일은 «브라우저를 모른다». 입력은 `PageFacts`(평범한 객체)뿐이다.
 *   그래서 ①단위 시험이 되고 ②aside·CDP·Playwright 어느 운반으로도 쓸 수 있다.
 *   수집기(브라우저에서 도는 쪽)는 `collect.ts` 가 «문자열로» 갖는다.
 *
 * 🧭 판정은 «셋»이다 — 🅕 의 근거 계급 다섯째 칸을 여기서 쓴다(`#16815`):
 *   `ok`           얻었다
 *   `missing`      «있어야 하는데» 이 페이지에 없다   → 사람이 채우거나 소스를 바꾼다
 *   `unmeasurable` ***이 사다리로는 못 잰다***        → ⛔ 「더 크롤하면 된다」가 «거짓»인 칸
 *   `image-only`   ⭐ **자료는 «있는데» 형식이 다르다** → 텍스트가 아니라 «이미지 안»에 있다
 *   ⇒ ⛔ 셋을 «같은 값으로 접지 마라» — 처방이 전부 다르다:
 *     `missing`      판매자가 채우게 하거나 사람이 확인
 *     `unmeasurable` 사람 칸으로 «설계»한다 (더 크롤해도 안 나온다)
 *     `image-only`   **OCR 축을 붙이면 «기계가» 얻는다** (지금은 못 얻을 뿐이다)
 *
 * 🔴 넷째 상태(`image-only`)는 무신사에서 «발견»됐다(2026-09-10):
 *   소재·충전재 스펙이 DOM 에 «한 글자도 없고» 상세 이미지 «안»에 있었다 —
 *   `FABRIC 겉감 나일론 100% · 충전재 덕다운(솜털 80%, 깃털 20%) · FIT 레귤러`.
 *   ⛔ 그것을 `missing` 으로 적으면 「판매자가 안 채웠다」는 «거짓»이 되고,
 *     `unmeasurable` 로 적으면 「영영 못 얻는다」는 «거짓»이 된다. ⇒ 이름이 «따로» 필요하다.
 */

/** 브라우저에서 «한 번» 긁어 오는 사실들. ⛔ 해석하지 않는다 — 판정은 이 파일이 한다. */
export interface PageFacts {
  readonly url: string;
  readonly title: string;
  /** 제품명 후보 — 여러 선택자에서 모은다. ⛔ 하나만 믿지 않는다. */
  readonly nameCandidates: readonly string[];
  /** 가격 문자열 후보(원 단위 숫자를 포함한 것). */
  readonly priceCandidates: readonly string[];
  /** 「키 → 값」으로 읽힌 고시/사양 칸. ⛔ 표일 수도, `li > strong` 일 수도 있다. */
  readonly specRows: Readonly<Record<string, string>>;
  /** 상세 이미지 후보 — 크기를 «측정한 값»이어야 한다(선언 폭이 아니라 naturalWidth). */
  readonly images: readonly { readonly src: string; readonly w: number; readonly h: number }[];
  /** 펼치기 전후 실측. ⛔ 「클릭이 필요한가」를 «추측하지 않는다». */
  /** 🔴 클릭이 «페이지를 떠나게» 만들었으면 이 칸이 채워진다 — 그 뒤 수집은 «다른 페이지»다. */
  readonly navigatedAway?: { readonly from: string; readonly to: string; readonly by: string };
  readonly expansion?: {
    readonly clicked: readonly string[];
    /** ⛔ 「안 눌렀다」의 «이유»를 남긴다 — 링크라서 건너뛴 것과 «못 찾은 것»은 다른 값이다. */
    readonly skipped?: readonly string[];
    readonly before: { readonly docHeight: number; readonly imageCount: number; readonly imagePixels: number };
    readonly after: { readonly docHeight: number; readonly imageCount: number; readonly imagePixels: number };
  };
}

export type CheckStatus = 'ok' | 'missing' | 'unmeasurable' | 'image-only';

export interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: CheckStatus;
  /** ⛔ 「왜 그렇게 판정했나」의 «값». 숫자와 문면을 담는다 — 다음 사람이 다시 안 재도 되게. */
  readonly evidence: string;
  /** 얻은 값(있으면). */
  readonly value?: unknown;
}

export interface GroundingVerdict {
  readonly url: string;
  readonly checks: readonly CheckResult[];
  /** ⛔ 필수 칸이 «전부» ok 여야 참. `unmeasurable` 은 통과가 «아니다». */
  readonly passed: boolean;
  /** 사람이 채워야 하는 칸 — `missing` ⊕ `unmeasurable` 을 «구분해서» 담는다. */
  readonly humanSlots: readonly { readonly id: string; readonly status: Exclude<CheckStatus, 'ok'>; readonly why: string }[];
}

/** 상세 이미지로 «셀 만한» 최소 크기. ⛔ 아이콘·배지·로고를 제품 상세로 세지 않기 위해서다. */
const DETAIL_MIN_WIDTH = 400;
const DETAIL_MIN_HEIGHT = 400;

/**
 * 🏷️ 품목 «카테고리» — ⛔ 고시 축은 카테고리마다 «다르다».
 *
 * 🔴 실측(2026-09-10 무신사): 의류에 화장품 축(용량·사용기한)을 대면 «언제나 미통과»가 난다.
 *   그건 페이지 결함이 아니라 ***내 자가 틀린 것***이다.
 *   ⇒ 카테고리를 «먼저» 정하고, 그 카테고리의 축으로만 묻는다.
 * ⛔ 카테고리를 «못 정하면» 그것도 값이다(`unknown`) — 억지로 하나를 고르지 않는다.
 */
export type ProductCategory = 'cosmetic' | 'apparel' | 'unknown';

const CATEGORY_HINTS: readonly { readonly category: Exclude<ProductCategory, 'unknown'>; readonly any: readonly string[] }[] = [
  { category: 'cosmetic', any: ['화장품', '용량(중량)', '내용물의 용량', '사용기한 또는 개봉'] },
  { category: 'apparel', any: ['총장', '어깨너비', '가슴단면', '소매길이', '품번', '시즌'] },
];

/** 고시 축 — ⛔ 카테고리마다 다르다. `unknown` 이면 «공통 축»만 묻는다. */
const AXES_BY_CATEGORY: Readonly<Record<ProductCategory, readonly { readonly id: string; readonly label: string; readonly any: readonly string[] }[]>> = {
  cosmetic: [
    { id: 'volume', label: '용량/중량', any: ['용량', '중량'] },
    { id: 'maker', label: '제조/책임판매업자', any: ['제조업자', '책임판매', '제조사', '판매업자'] },
    { id: 'origin', label: '제조국', any: ['제조국', '원산지'] },
    { id: 'expiry', label: '사용기한', any: ['사용기한', '개봉 후'] },
  ],
  apparel: [
    { id: 'size', label: '치수', any: ['총장', '어깨너비', '가슴단면', '사이즈'] },
    { id: 'model', label: '품번', any: ['품번', '모델명', '제품번호'] },
    { id: 'season', label: '시즌/성별', any: ['시즌', '성별'] },
  ],
  unknown: [],
};

/** 카테고리를 «키와 값 모두»에서 찾는다. ⛔ 하나만 보면 놓친다(쿠팡 실측이 그랬다). */
export function detectCategory(rows: Readonly<Record<string, string>>): ProductCategory {
  const hay = Object.entries(rows).map(([k, v]) => `${k} ${v}`).join(' ');
  for (const h of CATEGORY_HINTS) if (h.any.some((n) => hay.includes(n))) return h.category;
  return 'unknown';
}

/**
 * ⛔⭐ 법적 지위(기능성 여부) — 🩸 나는 이 칸을 «두 번» 틀리게 판정했다.
 *
 *   1차: 「에바스엔 `기능성 여부` 필드가 있고 OBgE 엔 없다 ⇒ 이 사다리로는 못 잰다(`unmeasurable`)」
 *   🔴 **틀렸다.** 쿠팡 OBgE 의 구조화 데이터에 «있었다» — 다만 «별도 키»가 아니라 «다른 칸의 값 안»에:
 *
 *     "화장품법에 따라 기재, 표시하여야 하는 모든 성분"
 *       = "… 기능성 화장품 심사(또는 보고)를 필함 해당 유무 유/자외선차단,미백,주름개선"
 *
 *   ⇒ 나는 «키»만 뒤지고 «값»은 안 봤다. ***「없다」가 아니라 「내가 안 본 곳에 있었다」였다.***
 *
 * 📌 그래서 규칙이 «둘»로 갈린다:
 *   ✅ `specRows` 의 «키와 값 모두»를 뒤진다 — 구조화된 자료 안이라 광고가 안 섞인다
 *   ⛔ 페이지 «본문»은 절대 grep 하지 않는다 — 실측: `기능성` 9건 중 대부분이
 *     `ui-recommendation-list`·`promotion-carousel` 의 «다른 상품» 문구였다
 */
const LEGAL_PATTERNS = ['기능성 화장품', '기능성화장품', '기능성 여부', '심사(또는 보고)'] as const;

const pickLongest = (xs: readonly string[]): string | undefined =>
  xs.map((s) => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0];

/**
 * 축을 «키와 값 «모두»»에서 찾는다.
 *
 * 🩸 나는 이것을 «두 번» 틀렸다 — 둘 다 「키만 뒤지고 없다고 읽은」 것이다:
 *   ① 기능성  → 쿠팡에선 "…모든 성분" 칸의 «값» 안에 있었다
 *   ② 제조국  → 쿠팡에선 "화장품제조업자…" 칸의 «값» 안에 있었다
 *     ("한국콜마(주) / 주식회사 어댑트 «제조국 대한민국»")
 * ⇒ 📌 ***판매 사이트는 고시 여러 칸을 «한 칸에 이어 붙인다».*** 키 이름만 믿으면 놓친다.
 * ⛔ 그래도 «본문»으로는 안 넓힌다 — 거기엔 광고로 붙은 «다른 상품»이 있다(실측).
 *   범위는 «구조화된 `specRows` 안»으로 못 박는다.
 */
const findSpec = (
  rows: Readonly<Record<string, string>>,
  any: readonly string[],
): { key: string; text: string; matchedIn: 'key' | 'value' } | undefined => {
  for (const [k, v] of Object.entries(rows)) {
    if (any.some((needle) => k.includes(needle))) return { key: k, text: v, matchedIn: 'key' };
  }
  for (const [k, v] of Object.entries(rows)) {
    if (any.some((needle) => v.includes(needle))) return { key: k, text: v, matchedIn: 'value' };
  }
  return undefined;
};

export function evaluateGrounding(facts: PageFacts): GroundingVerdict {
  const checks: CheckResult[] = [];

  // ── ① 제품명 ────────────────────────────────────────────────
  const name = pickLongest(facts.nameCandidates);
  checks.push({
    id: 'product-name', label: '제품명', required: true,
    status: name ? 'ok' : 'missing',
    evidence: name ? `후보 ${facts.nameCandidates.length}개 중 최장: "${name.slice(0, 60)}"` : `후보 ${facts.nameCandidates.length}개 전부 빔`,
    ...(name ? { value: name } : {}),
  });

  // ── ② 가격 ──────────────────────────────────────────────────
  const price = facts.priceCandidates.find((p) => /\d/.test(p));
  checks.push({
    id: 'price', label: '가격', required: false,
    status: price ? 'ok' : 'missing',
    evidence: price ? `"${price.slice(0, 40)}"` : `후보 ${facts.priceCandidates.length}개에 숫자가 없다`,
    ...(price ? { value: price } : {}),
  });

  // ── ②b 카테고리 ────────────────────────────────────────────
  const category = detectCategory(facts.specRows);
  checks.push({
    id: 'category', label: '품목 카테고리', required: true,
    status: category === 'unknown' ? 'missing' : 'ok',
    evidence: category === 'unknown'
      ? `고시 ${Object.keys(facts.specRows).length}칸에서 카테고리 단서를 못 찾았다 — 축을 «못 고른다»`
      : `${category} (이 카테고리의 축으로만 묻는다)`,
    value: category,
  });

  // ── ③ 고시 축 — ⛔ 카테고리마다 «다르다» ────────────────────
  for (const axis of AXES_BY_CATEGORY[category]) {
    const hit = findSpec(facts.specRows, axis.any);
    checks.push({
      id: `spec-${axis.id}`, label: `고시·${axis.label}`, required: true,
      status: hit ? 'ok' : 'missing',
      evidence: hit
        ? `${hit.matchedIn === 'value' ? '⚠️ «값» 안에서 찾음 — ' : ''}"${hit.key}" = "${hit.text.slice(0, 70)}"`
        : `고시 ${Object.keys(facts.specRows).length}칸의 «키·값 어디에도» [${axis.any.join('|')}] 없음`,
      ...(hit ? { value: hit } : {}),
    });
  }

  // ── ④ 법적 지위 — 화장품에만 묻는다 ⊕ «키와 값 모두» 뒤진다 ──
  if (category === 'cosmetic') {
    const legal = Object.entries(facts.specRows)
      .find(([k, v]) => LEGAL_PATTERNS.some((p) => k.includes(p) || v.includes(p)));
    checks.push({
      id: 'legal-status', label: '법적 지위(기능성 여부)', required: true,
      status: legal ? 'ok' : 'missing',
      evidence: legal
        ? `"${legal[0]}" 의 «값»에서 찾음 — "${legal[1].slice(0, 90)}"`
        : `고시 ${Object.keys(facts.specRows).length}칸의 «키·값 어디에도» [${LEGAL_PATTERNS.join('|')}] 없음. `
          + '⛔ 본문 grep 으로 메우지 마라 — 그것은 «광고로 붙은 다른 상품»을 문다(실측 9건 중 대부분). '
          + '⇒ 판매자가 고시를 안 채운 것이므로 «사람이» 확인한다.',
      ...(legal ? { value: { key: legal[0], text: legal[1] } } : {}),
    });
  }

  // ── ④b 이미지 «안»에만 있는 사실 — ⭐ 무신사에서 발견된 넷째 상태 ────
  //   📏 실측: 의류 상세는 소재·충전재·핏을 «이미지로» 넣는다(DOM 엔 한 글자도 없다).
  //     ⇒ 「긴 상세 이미지가 많은데 그 축의 텍스트가 없다」면 «이미지 안에 있을 공산이 크다».
  //   ⛔ 이것을 「없다」로 적으면 다음 창이 크롤러를 고치려 든다 — 고칠 것은 «OCR 축»이다.
  if (category === 'apparel') {
    const materialAxes = ['소재', '혼용률', '겉감', '안감', '충전재', '핏'];
    const inText = findSpec(facts.specRows, materialAxes);
    const longImages = facts.images.filter((i) => i.w >= 700 && i.h >= 1500).length;
    checks.push({
      id: 'material-spec', label: '소재·충전재', required: true,
      status: inText ? 'ok' : longImages > 0 ? 'image-only' : 'missing',
      evidence: inText
        ? `"${inText.key}" = "${inText.text.slice(0, 60)}"`
        : longImages > 0
          ? `고시 텍스트엔 [${materialAxes.join('|')}] 가 없는데 «세로 1500px 이상 상세 이미지가 ${longImages}장» 있다. `
            + '⇒ 이미지 «안»에 있을 공산이 크다(무신사 실측: FABRIC/충전재/FIT 이 전부 이미지였다). '
            + '⛔ 크롤러를 고칠 일이 아니라 «OCR 축»을 붙일 일이다.'
          : '텍스트에도 없고 «긴 상세 이미지»도 없다 — 판매자가 안 실었다',
      ...(inText ? { value: inText } : { value: { longImages } }),
    });
  }

  // ── ⑤ 상세 이미지 ──────────────────────────────────────────
  const detail = facts.images.filter((i) => i.w >= DETAIL_MIN_WIDTH && i.h >= DETAIL_MIN_HEIGHT);
  const detailPixels = detail.reduce((s, i) => s + i.h, 0);
  checks.push({
    id: 'detail-images', label: '상세 이미지', required: true,
    status: detail.length > 0 ? 'ok' : 'missing',
    evidence: `${DETAIL_MIN_WIDTH}×${DETAIL_MIN_HEIGHT} 이상 ${detail.length}장 · 세로 합 ${detailPixels}px `
      + `(측정한 이미지 전체 ${facts.images.length}장)`,
    value: { count: detail.length, pixels: detailPixels },
  });

  // ── ⑤b 페이지를 떠나지 «않았나» ────────────────────────────
  //   🔴 실측(무신사): 「더보기」가 펼치기가 아니라 «네비게이션 링크»였고 수집기가 /cs/notice 로 갔다.
  //     ⇒ 그 뒤 모든 수집이 «다른 페이지»를 잰다. 이 칸이 없으면 그 오염이 «조용하다».
  if (facts.navigatedAway) {
    checks.push({
      id: 'stayed-on-page', label: '같은 페이지에 남았나', required: true, status: 'missing',
      evidence: `🔴 "${facts.navigatedAway.by}" 를 누르니 «떠났다» — ${facts.navigatedAway.to}. `
        + '이 수집 결과는 «무효»다(다른 페이지를 쟀다).',
      value: facts.navigatedAway,
    });
  } else {
    checks.push({
      id: 'stayed-on-page', label: '같은 페이지에 남았나', required: true, status: 'ok',
      evidence: '펼치기 클릭이 페이지를 안 떠났다',
    });
  }

  // ── ⑥ 펼치기를 «쟀나» ──────────────────────────────────────
  //   ⛔ 「클릭이 필요한가」는 사이트마다 다르고 «추측하면 틀린다».
  //     실측: 쿠팡 = 클릭해도 이미지 그대로(컨테이너만 폄) · 네이버 = 클릭이 «필수»(+26장 +13,000px)
  if (!facts.expansion) {
    checks.push({
      id: 'expansion-measured', label: '펼치기 전후 측정', required: true, status: 'missing',
      evidence: '⛔ 펼치기를 «누르고 전후를 세지» 않았다 — 「전부 받았다」를 확인할 수 없다',
    });
  } else {
    const { before, after, clicked } = facts.expansion;
    const skipped = facts.expansion.skipped ?? [];
    const dImg = after.imageCount - before.imageCount;
    const dPx = after.imagePixels - before.imagePixels;
    const dDoc = after.docHeight - before.docHeight;
    checks.push({
      id: 'expansion-measured', label: '펼치기 전후 측정', required: true, status: 'ok',
      evidence: `클릭 [${clicked.join(', ') || '없음'}]${skipped.length ? ` · 건너뜀 [${skipped.join(', ')}]` : ''} → 이미지 ${dImg >= 0 ? '+' : ''}${dImg}장 · `
        + `${dPx >= 0 ? '+' : ''}${dPx}px · 문서 ${dDoc >= 0 ? '+' : ''}${dDoc}px. `
        + (dImg > 0
          ? '⇒ 이 사이트는 클릭이 «필수»다(안 누르면 상세를 잃는다).'
          : dDoc > 0
            ? '⇒ 클릭은 «컨테이너만» 폈다 — 이미지는 이미 로드돼 있었다.'
            : '⇒ 클릭이 «아무것도» 안 바꿨다 — 누를 것이 없거나 못 찾았다.'),
      value: { deltaImages: dImg, deltaPixels: dPx, deltaDocHeight: dDoc },
    });
  }

  const required = checks.filter((c) => c.required);
  return {
    url: facts.url,
    checks,
    passed: required.every((c) => c.status === 'ok'),
    humanSlots: checks
      .filter((c) => c.status !== 'ok')
      .map((c) => ({ id: c.id, status: c.status as Exclude<CheckStatus, 'ok'>, why: c.evidence })),
  };
}

/** 사람이 읽는 한 화면. ⛔ 통과/실패만 내지 않는다 — «무엇이 왜» 빠졌는지 이름을 댄다. */
export function formatVerdict(v: GroundingVerdict): string {
  const icon = (s: CheckStatus) =>
    s === 'ok' ? '✅' : s === 'missing' ? '⛔' : s === 'image-only' ? '🖼️' : '🧭';
  const lines = [
    `${v.passed ? '✅ 통과' : '⛔ 미통과'} — ${v.url}`,
    ...v.checks.map((c) => `  ${icon(c.status)} ${c.label}${c.required ? '' : ' (선택)'} — ${c.evidence}`),
  ];
  if (v.humanSlots.length > 0) {
    lines.push('', '📌 사람 칸:');
    for (const s of v.humanSlots) {
      const label = s.status === 'missing' ? '⛔ 없다(더 밟으면 나올 수 있다)'
        : s.status === 'image-only' ? '🖼️ 이미지 «안»에 있다 — OCR 축을 붙이면 기계가 얻는다'
        : '🧭 이 사다리로는 «못 잰다»';
      lines.push(`  ${label} · ${s.id}`);
    }
  }
  return lines.join('\n');
}
