/**
 * api-surface.ts — 「이 사이트가 ***자기 서버***를 부르나」만 답한다.
 *
 * ⛔ 왜 있나 (2026-09-10 🅕 실측 · 로드맵 Ⓒ 의 「이 도구가 못 낸 것」):
 *    `har-to-openapi` 는 훌륭하고 «우리 물음에 답한다» — 도메인별로 스펙을 가르고,
 *    `x-har-observations`(presenceRatio·sampleCount)로 ***근거를 값으로*** 낸다.
 *    ⇒ ⭐ 그러니 스펙 생성은 **그 도구를 쓴다**. 우리 것을 짓지 않는다.
 *
 *    그런데 그 자가 «못 답하는» 것이 하나 있고, 그것이 하필 다음 칸(Ⓓ 대상 고르기)의 본체다:
 *    ***「도메인 열한 개 중 어느 것이 «이 앱 자신의» 계약인가」.***
 *    caniuse.com 실측에서 XHR 4건이 «전부» 분석·광고였고, 도구가 낸 caniuse 스펙 14 path 는
 *    «전부 정적 자산»이었다. ⇒ 도구 탓이 아니라 ***대상 탓***인데, 그 판정을 낼 자가 없었다.
 *
 * ⛔⭐ 「모르겠다」를 static 으로 접지 않는다 — `unknown` 이 «값»으로 남는다.
 */

export type SurfaceKind = 'first-party-api' | 'third-party-api' | 'static' | 'document' | 'navigation' | 'unknown';

/** CDP `Network.*` 의 resourceType 중 «계약»에 해당하는 것 */
export const API_TYPES: readonly string[] = ['XHR', 'Fetch', 'EventSource'];
/** «화면 재료»에 해당하는 것 — 계약이 아니다 */
export const STATIC_TYPES: readonly string[] = ['Image', 'Font', 'Stylesheet', 'Script', 'Media', 'Manifest', 'Other'];

export interface SurfaceEntry {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string | null;
  readonly status: number | null;
  readonly mimeType: string | null;
  /** ⛔ 있으면 «항해»를 가릴 수 있다. 없으면 mime·질의로만 본다(놓치면 계약 쪽으로 기운다). */
  readonly requestHeaders?: Readonly<Record<string, string>>;
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * ⛔ 「같은 출처」는 origin 동일이 «아니라» 등록가능도메인(eTLD+1 근사)으로 본다 —
 *    `api.x.com` 과 `www.x.com` 은 «같은 앱»이다. ⚠️ 근사다(공개 접미사 목록을 안 쓴다) —
 *    `foo.github.io` 같은 자리에서 틀릴 수 있다. 그래서 «근사»라고 이름에 적는다.
 */
export function registrableApprox(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set(['co.uk', 'co.kr', 'com.au', 'co.jp', 'com.br', 'co.nz', 'or.kr', 'ne.jp', 'com.cn']);
  const lastTwo = parts.slice(-2).join('.');
  return twoLevelTlds.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function sameApp(a: string, b: string): boolean {
  try {
    return registrableApprox(new URL(a).hostname) === registrableApprox(new URL(b).hostname);
  } catch {
    return false;
  }
}

/**
 * ⛔⭐⭐⭐ ***「계약」과 「항해」를 «가른다».***
 *
 * 🩸 실측(2026-09-11 · 내가 «직접 쓴» 계약으로 반증): `bilryo-dongne` 는 Next 서버 컴포넌트라
 *    브라우저가 API 를 ***한 번도 안 부른다***(HAR 의 `/api/` 요청 = **0건**).
 *    그런데 이 자는 ***「자기 API 6 · 계약을 추론할 «거리»가 있다」***고 말했다.
 *    ⛔ 그 여섯은 `GET /items/drill-01?_rsc=…` — **Next 라우트 프리페치**,
 *       즉 ***다음 «화면»을 미리 받는 항해***이지 계약이 아니다.
 *    반증 근거: 요청 헤더 `rsc=1` · `next-router-prefetch=1` · 응답 `text/x-component`.
 * 🔑 이것은 렌더 미러가 «자원 ↔ 항해»를 뭉갰던 것과 ***같은 족속***이다.
 *    CDP 는 프레임워크 프리페치도 `Fetch` 로 분류한다 — ***resourceType 만 보면 못 가른다.***
 */
export const NAVIGATION_MIMES: readonly string[] = ['text/x-component'];
/** ⛔ 헤더 이름은 «소문자»로 비교한다 — CDP 가 소문자로 준다. */
export const NAVIGATION_HEADERS: readonly string[] = ['rsc', 'next-router-prefetch', 'next-router-state-tree'];
/** 질의 열쇠만으로도 갈리는 것들. */
export const NAVIGATION_QUERY_KEYS: readonly string[] = ['_rsc', '__flight__'];

export function isFrameworkNavigation(entry: SurfaceEntry): boolean {
  const mime = (entry.mimeType ?? '').split(';')[0]!.trim().toLowerCase();
  if (NAVIGATION_MIMES.includes(mime)) return true;
  const headers = entry.requestHeaders ?? {};
  for (const name of Object.keys(headers)) {
    if (NAVIGATION_HEADERS.includes(name.toLowerCase())) return true;
  }
  try {
    const u = new URL(entry.url);
    for (const k of NAVIGATION_QUERY_KEYS) if (u.searchParams.has(k)) return true;
  } catch { /* 못 읽으면 아니다 */ }
  return false;
}

export function classifyEntry(entry: SurfaceEntry, pageUrl: string): SurfaceKind {
  const type = entry.resourceType;
  if (type === 'Document') return 'document';
  if (type !== null && API_TYPES.includes(type)) {
    // ⛔ 프레임워크 항해를 «먼저» 걷는다 — 안 그러면 계약 수가 부풀고 «거짓 자신»이 된다.
    if (isFrameworkNavigation(entry)) return 'navigation';
    return sameApp(entry.url, pageUrl) ? 'first-party-api' : 'third-party-api';
  }
  if (type !== null && STATIC_TYPES.includes(type)) return 'static';
  // ⛔ 여기서 static 으로 «접지 않는다» — 모르는 것은 모른다고 남긴다
  return 'unknown';
}

/**
 * ⛔⭐⭐ ***같은 엔드포인트를 «id 마다» 세지 않는다.***
 *
 * 🩸 실측(2026-09-11): `/items/drill-01` · `/items/ladder-02` · … 를 ***여섯 종«**으로 셌다.
 *    계약은 하나(`/items/{id}`)인데 자는 「엔드포인트 6종」이라 말했다.
 * 🔑 판정은 ***형제 요청«들»을 같이 봐야*** 난다 — 한 URL 만 보면 `drill-01` 이 상수인지 변수인지 모른다.
 *    ⇒ 같은 «칸 수»의 경로를 모아, ***한 칸만 다르고 나머지가 같으면*** 그 칸을 변수로 접는다.
 * ⛔ 한 번만 본 경로는 «안 접는다» — 표본 하나로 「변수다」라고 말할 수 없다.
 */
export const PATH_VARIABLE = '{id}';
/** ⛔ 몇 개부터 「변수」라 부를지. 2 면 우연히 둘 본 것도 접힌다 ⇒ 2 로 두되 «값»으로 낸다. */
export const MIN_SIBLINGS_TO_FOLD = 2;

/**
 * ⛔⭐ ***「한 칸만 다르다」만으로는 부족하다.***
 * 🩸 내 시험이 잡았다: `/v1/items` 와 `/v1/cart` 도 「한 칸만 다르다」라 `{id}` 로 접혔다.
 *    둘은 ***다른 컬렉션***이지 id 변형이 아니다.
 * 🔑 ⇒ ***변하는 값들이 «식별자처럼 생겼는지»***를 같이 본다.
 * ⚪ 못 잡는 것: 숫자 없는 슬러그(`/posts/hello-world`)는 «안 접는다» —
 *    ⛔ 그 방향이 맞다(모르면 «안 접는다»). 「접혔어야 하는데 안 접혔다」는 «보이지만»
 *    「안 접혔어야 하는데 접혔다」는 ***조용히 계약을 지운다***.
 */
export function looksLikeIdentifier(segment: string): boolean {
  if (segment.length === 0) return false;
  if (/\d/.test(segment)) return true;                       // drill-01 · 12345 · v1abc
  if (segment.length >= 16) return true;                     // 긴 해시·토큰
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return true; // uuid
  return false;
}

export function foldPathVariables(paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const byShape = new Map<string, string[]>();
  for (const path of paths) {
    const segs = path.split('/');
    byShape.set(String(segs.length), [...(byShape.get(String(segs.length)) ?? []), path]);
  }
  for (const group of byShape.values()) {
    if (group.length < MIN_SIBLINGS_TO_FOLD) continue;
    const split = group.map((p) => p.split('/'));
    const width = split[0]!.length;
    for (let i = 0; i < width; i += 1) {
      const values = new Set(split.map((segs) => segs[i]!));
      if (values.size < MIN_SIBLINGS_TO_FOLD) continue;
      // ⛔ «그 칸만» 다르고 나머지가 전부 같은 짝이 있어야 접는다.
      const others = new Set(split.map((segs) => segs.filter((_, j) => j !== i).join('/')));
      if (others.size !== 1) continue;
      // ⛔ 변하는 값이 «전부» 식별자처럼 생겨야 접는다 — 아니면 다른 컬렉션이다.
      if (![...values].every(looksLikeIdentifier)) continue;
      for (const segs of split) {
        const folded = segs.map((seg, j) => (j === i ? PATH_VARIABLE : seg)).join('/');
        out.set(segs.join('/'), folded);
      }
    }
  }
  return out;
}

export interface ApiEndpoint {
  readonly method: string;
  readonly path: string;
  readonly origin: string;
  readonly statuses: readonly number[];
  readonly count: number;
  /** ⛔ 관측된 질의 열쇠 — 계약의 «파라미터»다. 값은 안 담는다(개인정보가 섞인다). */
  readonly queryKeys: readonly string[];
  /** 이 자리를 «접었나» — 접었으면 원래 본 경로 수. */
  readonly foldedFrom: number;
}

export interface ApiSurface {
  readonly pageUrl: string;
  readonly counts: Record<SurfaceKind, number>;
  readonly firstPartyEndpoints: readonly ApiEndpoint[];
  readonly thirdPartyOrigins: readonly string[];
  /** ⭐ Ⓓ 대상 고르기의 판정 — ⛔ 「좋다/나쁘다」가 아니라 «무엇을 봤나」로 말한다 */
  readonly verdict: 'calls-own-server' | 'no-own-api-observed' | 'unmeasurable';
  readonly verdictReason: string;
}

export function summarizeApiSurface(entries: readonly SurfaceEntry[], pageUrl: string): ApiSurface {
  const counts: Record<SurfaceKind, number> = {
    'first-party-api': 0, 'third-party-api': 0, static: 0, document: 0, navigation: 0, unknown: 0,
  };
  const raw: Array<{ method: string; path: string; origin: string; status: number | null; queryKeys: string[] }> = [];
  const thirdParty = new Set<string>();

  for (const entry of entries) {
    const kind = classifyEntry(entry, pageUrl);
    counts[kind] += 1;
    if (kind === 'first-party-api') {
      let path = entry.url;
      let origin = '';
      const queryKeys: string[] = [];
      try {
        const u = new URL(entry.url);
        path = u.pathname;
        origin = u.origin;
        // ⛔ 열쇠만 담는다 — 값에는 검색어·좌표·토큰이 섞인다.
        for (const k of u.searchParams.keys()) if (!queryKeys.includes(k)) queryKeys.push(k);
      } catch { /* 깨진 주소는 통째로 path 로 둔다 */ }
      raw.push({ method: entry.method, path, origin, status: entry.status, queryKeys });
    } else if (kind === 'third-party-api') {
      const o = originOf(entry.url);
      if (o) thirdParty.add(o);
    }
  }

  // ⛔ 접기는 «전부 모은 뒤»에 한다 — 형제를 봐야 변수인지 알 수 있다.
  const folds = foldPathVariables([...new Set(raw.map((r) => r.path))]);
  const byKey = new Map<string, {
    method: string; path: string; origin: string;
    statuses: Set<number>; count: number; queryKeys: Set<string>; sources: Set<string>;
  }>();
  for (const r of raw) {
    const path = folds.get(r.path) ?? r.path;
    const key = `${r.method} ${r.origin}${path}`;
    const found = byKey.get(key) ?? {
      method: r.method, path, origin: r.origin,
      statuses: new Set<number>(), count: 0, queryKeys: new Set<string>(), sources: new Set<string>(),
    };
    found.count += 1;
    found.sources.add(r.path);
    if (r.status !== null) found.statuses.add(r.status);
    for (const k of r.queryKeys) found.queryKeys.add(k);
    byKey.set(key, found);
  }

  const firstPartyEndpoints = [...byKey.values()]
    .map((e) => ({
      method: e.method, path: e.path, origin: e.origin,
      statuses: [...e.statuses].sort((a, b) => a - b), count: e.count,
      queryKeys: [...e.queryKeys].sort(),
      // ⛔ 「접었다」를 «수»로 남긴다 — 안 남기면 다음 사람이 6종이 1종이 된 이유를 못 찾는다.
      foldedFrom: e.path.includes(PATH_VARIABLE) ? e.sources.size : 0,
    }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

  let verdict: ApiSurface['verdict'];
  let verdictReason: string;
  if (entries.length === 0) {
    verdict = 'unmeasurable';
    verdictReason = '요청을 «하나도» 못 봤다 — ⛔ 「안 부른다」가 아니라 「못 쟀다」다(Network.enable 시점·스크롤 전 요청을 의심하라)';
  } else if (counts['first-party-api'] > 0) {
    verdict = 'calls-own-server';
    verdictReason = `자기 출처 API ${counts['first-party-api']}건 · 엔드포인트 ${firstPartyEndpoints.length}종 — 계약을 추론할 «거리»가 있다`;
  } else {
    verdict = 'no-own-api-observed';
    // ⛔⭐ 「안 보였다」의 «이유»를 갈라 말한다. 안 그러면 셋이 한 문장으로 뭉개진다:
    //    ⓐ 정말 API 가 없다 ⓑ 서버가 그려서 브라우저가 안 부른다(SSR) ⓒ 눌러야 나온다(L3).
    //    🩸 ⓑ 가 이 저장소의 사이트 «다섯 전부»였는데 자는 그 말을 «한 번도» 안 했다.
    const navHint = counts.navigation > 0
      ? ` ⭐ 다만 프레임워크 «항해» ${counts.navigation}건을 봤다 — 서버가 화면을 그리는 구조(SSR)라`
        + ' ***브라우저 관측으로는 계약이 원리상 안 보인다***. ⛔ 「API 가 없다」로 읽지 마라 — 이 자로는 «못 잰다».'
      : '';
    verdictReason = `요청 ${entries.length}건을 봤지만 자기 출처 API 는 0건 — ⛔ 「API 가 없다」가 아니라 «이 한 방문에서 안 보였다». 상호작용(L3) 뒤에 나올 수 있다${navHint}`;
  }

  return { pageUrl, counts, firstPartyEndpoints, thirdPartyOrigins: [...thirdParty].sort(), verdict, verdictReason };
}

export function formatApiSurface(surface: ApiSurface): string[] {
  const c = surface.counts;
  const lines = [
    `API 표면: ${surface.pageUrl}`,
    `  자기 API ${c['first-party-api']} · 남의 API ${c['third-party-api']} · 정적 ${c.static} · 문서 ${c.document}`
      + ` · 항해 ${c.navigation}(프레임워크 프리페치 — «계약이 아니다») · ⚪ 모름 ${c.unknown}`,
  ];
  for (const e of surface.firstPartyEndpoints.slice(0, 12)) {
    const fold = e.foldedFrom > 0 ? ` ⭐${e.foldedFrom}자리를 접었다` : '';
    // ⛔ 질의 «열쇠»는 계약의 파라미터다 — 안 내면 경로만 남고 계약의 절반이 사라진다.
    const q = e.queryKeys.length > 0 ? `  ?${e.queryKeys.join('&')}` : '';
    lines.push(`   ▸ ${e.method.padEnd(6)} ${e.path}  ×${e.count} ${e.statuses.length ? `[${e.statuses.join(',')}]` : '[상태 ⚪]'}${fold}${q}`);
  }
  if (surface.thirdPartyOrigins.length) {
    lines.push(`  남의 API 출처: ${surface.thirdPartyOrigins.slice(0, 6).join(' ')}${surface.thirdPartyOrigins.length > 6 ? ' …' : ''}`);
  }
  lines.push(`  ⇒ ${surface.verdict} — ${surface.verdictReason}`);
  return lines;
}
