/**
 * response-shape.ts — 관측한 응답 본문에서 ***「모양」***을 뽑는다.
 *
 * ⛔⭐ ***이것은 OpenAPI 스펙 생성기가 «아니다».***
 *    스펙 생성은 `har-to-openapi` 가 한다(RFC 가 그렇게 못 박았고, 재발명하지 않는다).
 *    이 자가 답하는 것은 ***「내가 쓴 계약을 «얼마나» 되찾나」*** ***하나뿐***이다.
 *    ⇒ 그래서 산출이 «스펙»이 아니라 ***「열쇠와 타입의 나무」***다 — 맞대 보기 위한 것.
 *
 * 🩸 왜 생겼나(2026-09-11 🅕): 앞 판에서 「RFC 추론이 «경로와 질의»는 되찾는데
 *    «응답 모양»은 못 낸다」고 적었다. 그런데 재 보니 ***재료가 없어서***였다 —
 *    `record-network --bodies` 가 ***이미 있는데 내가 안 썼다***. ⛔ 또 「있다」≠「닿는다」다.
 *
 * ⛔⭐ 「못 쟀음」을 「없음」으로 접지 않는다:
 *    본문이 «비면» `unmeasured` 다. 「응답이 비었다」가 «아니다».
 */

export type ShapeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'unknown';

export interface ShapeNode {
  readonly kind: ShapeKind;
  /** object 일 때 — 열쇠마다의 모양. ⛔ 관측 순서가 아니라 «이름 순»으로 둔다(대조가 흔들리지 않게). */
  readonly fields?: ReadonlyArray<readonly [string, ShapeNode]>;
  /** array 일 때 — 원소들의 모양을 «합친» 것. 빈 배열이면 `unknown`. */
  readonly element?: ShapeNode;
  /** array 일 때 관측한 원소 수. ⛔ 0 이면 「원소가 없다」이고 모양은 «못 쟀다». */
  readonly sampled?: number;
}

/** ⛔ 너무 깊으면 멈춘다 — 값으로 낸다. */
export const MAX_DEPTH = 8;

export function inferShape(value: unknown, depth = 0): ShapeNode {
  if (value === null) return { kind: 'null' };
  if (depth >= MAX_DEPTH) return { kind: 'unknown' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', element: { kind: 'unknown' }, sampled: 0 };
    // ⛔ 원소를 «합친다» — 첫 원소만 보면 「가끔 있는 필드」를 놓친다.
    let merged = inferShape(value[0], depth + 1);
    for (let i = 1; i < value.length; i += 1) merged = mergeShapes(merged, inferShape(value[i], depth + 1));
    return { kind: 'array', element: merged, sampled: value.length };
  }
  const t = typeof value;
  if (t === 'string') return { kind: 'string' };
  if (t === 'number') return { kind: 'number' };
  if (t === 'boolean') return { kind: 'boolean' };
  if (t === 'object') {
    const fields = Object.keys(value as Record<string, unknown>).sort()
      .map((k) => [k, inferShape((value as Record<string, unknown>)[k], depth + 1)] as const);
    return { kind: 'object', fields };
  }
  return { kind: 'unknown' };
}

/** ⛔ 둘을 합칠 때 «충돌»을 `unknown` 으로 접지 않고, 열쇠는 «합집합»으로 둔다. */
export function mergeShapes(a: ShapeNode, b: ShapeNode): ShapeNode {
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  if (a.kind !== b.kind) return { kind: 'unknown' };
  if (a.kind === 'object') {
    const map = new Map<string, ShapeNode>((a.fields ?? []).map(([k, v]) => [k, v]));
    for (const [k, v] of b.fields ?? []) {
      const prev = map.get(k);
      map.set(k, prev === undefined ? v : mergeShapes(prev, v));
    }
    return { kind: 'object', fields: [...map.entries()].sort((x, y) => x[0].localeCompare(y[0])) };
  }
  if (a.kind === 'array') {
    return {
      kind: 'array',
      element: mergeShapes(a.element ?? { kind: 'unknown' }, b.element ?? { kind: 'unknown' }),
      sampled: (a.sampled ?? 0) + (b.sampled ?? 0),
    };
  }
  return a;
}

/** 사람이 읽는 한 줄짜리 나무. ⛔ 값은 «안 담는다» — 개인정보·검색어가 섞인다. */
export function formatShape(node: ShapeNode, indent = 0): string[] {
  const pad = '  '.repeat(indent);
  if (node.kind === 'object') {
    if ((node.fields ?? []).length === 0) return [`${pad}{} (열쇠 «없음»)`];
    return (node.fields ?? []).flatMap(([k, v]) => {
      if (v.kind === 'object' || v.kind === 'array') return [`${pad}${k}:`, ...formatShape(v, indent + 1)];
      return [`${pad}${k}: ${v.kind}`];
    });
  }
  if (node.kind === 'array') {
    const n = node.sampled ?? 0;
    if (n === 0) return [`${pad}[] — ⛔ 원소가 «없다» ⇒ 모양은 «못 쟀다»`];
    return [`${pad}[${n}개] 원소:`, ...formatShape(node.element ?? { kind: 'unknown' }, indent + 1)];
  }
  return [`${pad}${node.kind}`];
}

/** 최상위 열쇠만. ⛔ 대조용 — 없으면 빈 배열이고 그것은 「못 쟀음」과 «다르다». */
export function topKeys(node: ShapeNode): readonly string[] {
  return node.kind === 'object' ? (node.fields ?? []).map(([k]) => k) : [];
}

export interface ShapeRecovery {
  /** 정답에 있고 관측에도 «있는» 열쇠 */
  readonly found: readonly string[];
  /** 정답에 있는데 «못 본» 열쇠 — ⛔ 「서버에 없다」가 아니라 「이 방문에서 안 보였다」 */
  readonly missed: readonly string[];
  /** 관측에 «있는데» 정답에 없는 열쇠 — ⭐ 내 계약이 «덜 적은» 것일 수 있다 */
  readonly extra: readonly string[];
}

/**
 * ⛔⭐ 「되찾음」을 «세 갈래»로 낸다.
 *    `extra` 를 「틀림」으로 읽지 않는다 — ***내가 계약에 «안 적은» 것***일 수 있고,
 *    그때 고쳐야 할 것은 «추론»이 아니라 ***계약 문서***다.
 */
export function compareKeys(observed: readonly string[], expected: readonly string[]): ShapeRecovery {
  const o = new Set(observed);
  const e = new Set(expected);
  return {
    found: expected.filter((k) => o.has(k)),
    missed: expected.filter((k) => !o.has(k)),
    extra: observed.filter((k) => !e.has(k)).sort(),
  };
}

/** ⛔ 이 자가 «못 담는» 것을 값으로 낸다. */
export const RESPONSE_SHAPE_BLIND_SPOTS: readonly string[] = [
  'one-sample: 한 번의 응답만 봤다 — 「가끔 있는 필드」는 안 보인다',
  'error-shape: 오류 응답(4xx·5xx)은 «부르지 않으면» 안 나온다',
  // ⛔⭐ 2026-09-11 정정 — 옛 문면은 *"POST·PATCH 는 화면이 «누르지» 않으면 안 보인다"* 였다.
  //    ***그것은 늙었다*** — `record-network.ts` 에 `--flow` 가 «이미» 있고 click/type 걸음을 밟는다.
  //    ⇒ 「못 본다」가 아니라 ***「운영자가 «명시»해야 본다」***다. 남는 사각은 그 «명시» 쪽이다.
  'write-needs-a-flow: POST·PATCH 는 `--flow` 로 «걸음을 줘야» 난다 — 자동으로 «누르지 않는다».'
    + ' ⛔ 그것이 결손이 아니라 «결정»이다: 남의 사이트에서 아무 버튼이나 누르면 진짜 글이 나간다',
  'request-shape-needs-json: 요청 본문이 JSON 이 «아니면»(폼 인코딩·멀티파트) 모양을 못 낸다 — 「본문이 없다」가 아니다',
  'nullable: 한 표본에서 null 이면 「항상 null」인지 「그때만」인지 못 가른다',
  'unconsumed-response: ⛔ 페이지가 응답을 «안 읽으면» 브라우저가 스트림을 끝까지 안 당긴다'
    + ' ⇒ CDP 가 「No data found for resource with given identifier」를 낸다.'
    + ' 실제 사이트에서는 드물다(자기가 부른 것은 읽는다) — 대조군을 «그렇게» 만들면 안 된다',
];
