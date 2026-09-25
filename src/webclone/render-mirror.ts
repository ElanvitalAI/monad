/**
 * render-mirror.ts — ⛔⭐⭐ ***「브라우저가 «실제로» 받은 것」으로 미러를 만든다.***
 *
 * 🩸 왜 있나(2026-09-11 🅕 · 클론 재현율 실측):
 *    wget 미러의 충실성을 다섯 대상에 재 봤다.
 *      내 사이트(대조군)  본문 100.0% · RMSE 0.00%   ⇐ ***쉬웠던 것***(서버 렌더 · 외부 자산 0)
 *      about.instagram    본문 **4.2%**              ⇐ 클라이언트 렌더 — wget 은 «껍데기»만 받는다
 *      starbucks          네트워크 지배(로컬 1 ↔ 원격 7) ⇐ 미러가 원격을 계속 부른다
 *      kakao · youtube    미러 **failed**            ⇐ wget 이 아예 막힌다
 *    🔑 셋 다 원인이 하나다 — ***wget 은 「JS 가 실행된 뒤에 무엇을 받는지」를 모른다.***
 *
 * ✅ 그래서 이 자는 뒤집는다: ***브라우저를 «먼저» 돌리고, 그 브라우저가 받은 응답을 그대로 적는다.***
 *    ⑴ 렌더가 «멎을 때까지» 기다린다   ⑵ 받은 응답을 전부 파일로 적는다
 *    ⑶ 렌더된 DOM 을 적는다            ⑷ 참조를 «로컬 경로»로 바꾼다
 *
 * ⛔ 이 파일은 «순수»다 — 프로세스·네트워크를 안 탄다. 실행은 `scripts/webclone/render-mirror.ts`.
 */

/** ⛔ 미러 안에서 자원이 사는 뿌리. 값으로 낸다. */
import { extensionForMime, extensionMatchesMime } from './asset-kinds.js';

export const MIRROR_ROOT = '_r';

/** ⛔ 이름에 못 쓰는 글자. 「조용히 바꾸지」 않고 «무엇을 바꿨는지»는 경로가 말한다. */
const UNSAFE = /[^A-Za-z0-9._\-/]/g;

/** ⛔ 아주 긴 이름은 파일 시스템이 거부한다 — 자르되 «구분»은 해시가 지킨다. */
export const MAX_SEGMENT = 60;

/** 결정론적 짧은 해시. ⛔ 암호용이 아니라 «구분»용이다 — 그렇게 적는다. */
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 7);
}

export interface LocalPath {
  readonly path: string;
  /** ⛔ 왜 이 이름이 됐나 — 질의를 접었나·잘랐나. 읽는 쪽이 되짚을 수 있게. */
  readonly note: string | null;
}

/**
 * ⛔⭐ URL → 미러 안의 «로컬 경로». ***결정론적이어야 한다*** —
 *    같은 URL 이 두 번 다른 이름을 얻으면 참조가 끊긴다.
 * ⛔ 질의 문자열은 «버리지» 않는다 — 버리면 `?v=1` 과 `?v=2` 가 «같은 파일»이 된다.
 *    대신 이름에 «접어» 넣고 그 사실을 note 로 말한다.
 */
/**
 * ⛔⭐⭐ `mimeType` 을 «주면» 확장자를 계약에 맞춘다.
 * 🩸 안 맞추면 `file://` 에서 확장자 없는 CSS 가 `text/plain` 으로 읽혀 ***적용되지 않는다***
 *    (2026-09-11 about.instagram 실측 — 그 하나가 Meta 의 «메인» 시트였다).
 * ⛔ 모르는 MIME 이면 «건드리지 않는다» — 아무 확장자나 붙이면 또 다른 거짓말이 된다.
 */
export function localPathFor(rawUrl: string, mimeType?: string | null): LocalPath | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  // ⛔ data:·blob: 는 «파일이 아니다» — 이미 문서 안에 있다.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const notes: string[] = [];
  let pathname = u.pathname;
  if (pathname === '' || pathname.endsWith('/')) { pathname += 'index.html'; notes.push('디렉토리라 index.html 로 둔다'); }

  let segs = pathname.split('/').filter(Boolean).map((s) => s.replace(UNSAFE, '_'));
  segs = segs.map((s) => {
    if (s.length <= MAX_SEGMENT) return s;
    notes.push('이름이 길어 잘랐다(해시로 구분)');
    return `${s.slice(0, MAX_SEGMENT - 8)}-${shortHash(s)}`;
  });

  if (u.search !== '') {
    const last = segs.pop() ?? 'index.html';
    const dot = last.lastIndexOf('.');
    const stem = dot > 0 ? last.slice(0, dot) : last;
    const ext = dot > 0 ? last.slice(dot) : '';
    segs.push(`${stem}~${shortHash(u.search)}${ext}`);
    notes.push('질의를 이름에 «접었다» — 버리면 ?v=1 과 ?v=2 가 같은 파일이 된다');
  }

  // ⛔⭐ 확장자를 «계약»으로 맞춘다 — 이름이 MIME 과 어긋나면 브라우저가 다르게 읽는다.
  //    ⛔ «질의 접기 뒤»에 붙인다(앞에 붙이면 `a.css~hash` 가 되어 또 확장자가 없다).
  const want = extensionForMime(mimeType);
  if (want !== null) {
    const last = segs.pop() ?? 'index.html';
    if (!extensionMatchesMime(last, mimeType)) {
      segs.push(`${last}.${want}`);
      notes.push(`MIME 에 맞춰 «.${want}» 를 붙였다 — 확장자가 없으면 file:// 에서 text/plain 으로 읽힌다`);
    } else {
      segs.push(last);
    }
  }

  const host = u.host.replace(UNSAFE, '_');
  return { path: `${MIRROR_ROOT}/${host}/${segs.join('/')}`, note: notes.length ? notes.join(' · ') : null };
}

export interface CapturedResource {
  readonly url: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly local: string;
}

/**
 * ⛔⭐⭐ 문서 안의 참조를 «로컬 경로»로 바꾼다.
 *
 * 🔑 세 «모양»을 다 바꿔야 한다 — 하나라도 놓치면 그 자원은 «원격»으로 남고
 *    미러가 「네트워크 지배」가 된다(starbucks 에서 실제로 그랬다: 로컬 1 ↔ 원격 7).
 *      ① 절대     https://host/a.css
 *      ② 프로토콜 상대  //host/a.css
 *      ③ 뿌리 상대  /a.css        ⇐ ***문서와 «같은 출처»일 때만***
 * ⛔ 정규식으로 «URL 을 찾지» 않는다 — 받은 URL 목록을 «알고» 있으므로 그 문자열만 바꾼다.
 *    (정규식으로 찾으면 못 받은 URL 까지 바꿔 «깨진 링크»를 만든다.)
 */
/**
 * ⛔⭐⭐⭐ ***뿌리 상대형(`/a.woff2`)은 «그것을 적은 파일»의 출처로 푼다 — 문서 출처가 «아니다».***
 *
 * 🩸 실측(2026-09-11 · about.instagram): 미러가 ✅ self-contained 였고 stylesheet 4개가 전부
 *    파일로 있었는데도 화면이 ***세리프 · 1열***로 그려졌다. 자는 「CSS 0개」를 바꿨다고 «말하고» 있었다.
 *    범인은 CSS 안의 `@font-face { src: url(/rsrc.php/y5/r/_a_FWcDLOaW.woff2) }` 였다.
 *    그 `/rsrc.php/…` 는 ***`static.xx.fbcdn.net`***(그 CSS 의 출처) 기준인데
 *    자는 ***`about.instagram.com`***(문서 출처) 기준으로 보고 「내 것이 아니다」라며 «건너뛰었다».
 * 🔑 오늘 다섯 번째로 밟은 «같은 병» — ***두 축을 한 이름으로 불렀다.***
 *
 * ⊕ 그리고 그것만 고치면 «두 번째 버그»가 바로 뒤에 있다:
 *    치환이 내놓는 `_r/…` 는 ***문서 기준*** 경로다. `_r/host/a/b/c.css` 안에 그대로 쓰면
 *    `_r/host/a/b/_r/…` 로 풀린다. ⇒ 참조하는 «파일 자리»에서 되짚어야 한다(`mapLocal`).
 */
export function relativeFromMirrorFile(localPath: string): (local: string) => string {
  const depth = localPath.split('/').length - 1;   // 파일이 든 «폴더»의 깊이
  const up = depth <= 0 ? '' : '../'.repeat(depth);
  return (local) => `${up}${local}`;
}

export function rewriteReferences(
  text: string,
  resources: readonly CapturedResource[],
  documentOrigin: string,
  /** ⛔ 로컬 경로를 «참조하는 파일 기준»으로 옮긴다. 문서면 그대로, CSS 면 되짚는다. */
  mapLocal: (local: string) => string = (l) => l,
): { readonly text: string; readonly replaced: number; readonly missed: number } {
  // ⛔⭐⭐ 🩸 첫 판은 `split().join()` 을 «되풀이»했고, ***나중 치환이 앞선 결과를 다시 먹었다***:
  //    `https://x.com/a.js.map` 을 바꾼 뒤 `/a.js` 형태가 그 «결과 안»에서 또 맞아
  //    `_r/x.com_r/x.com_r/x.com/a.js.map` 이 나왔다(내 시험이 잡았다).
  // ✅ ⇒ ***한 번만 훑는다.*** 자리마다 «가장 긴» 형태부터 맞춰 보고, 맞으면 «건너뛴다».
  const forms: Array<{ form: string; local: string; rooted: boolean }> = [];
  const push = (form: string, local: string, rooted: boolean) => {
    forms.push({ form, local, rooted });
    // ⛔⭐⭐ 🩸 ***「받아 놓고 못 바꿨다」*** (2026-09-11 · about.instagram 실측).
    //    질의가 있는 URL 은 «요청»에서는 `?a=1&b=2` 인데
    //    `outerHTML` 로 직렬화된 «문서»에서는 ***`?a=1&amp;b=2`*** 다.
    //    그래서 12 preload ⊕ 6 img 가 ***파일을 `_r/` 에 받아 놓고도*** 원격으로 남았다.
    //    반증: `find _r -path '*lookaside*'` → 3개 «있었다». 못 받은 게 아니라 «못 바꾼» 것이다.
    // 🔑 ⇒ 실체참조 형태도 «같이» 찾는다. `&` 하나가 재현율을 20개어치 갉아먹었다.
    if (form.includes('&')) forms.push({ form: form.replace(/&/g, '&amp;'), local, rooted });
  };
  for (const r of resources) {
    const local = mapLocal(r.local);
    push(r.url, local, false);
    try {
      const u = new URL(r.url);
      push(`//${u.host}${u.pathname}${u.search}`, local, false);
      // ⛔ 뿌리 상대형은 «같은 출처»일 때만 — 다른 출처의 /a.css 는 «다른 파일»이다.
      //    ⭐ 그 「같은 출처」의 기준이 ***이 텍스트를 담은 파일의 출처***다(문서일 수도, CSS 일 수도).
      if (u.origin === documentOrigin) {
        push(`${u.pathname}${u.search}`, local, true);
      }
    } catch { /* 못 읽으면 절대형만 */ }
  }
  forms.sort((a, b) => b.form.length - a.form.length);

  /**
   * ⛔ 뿌리 상대형은 «경계»를 본다 — 안 그러면 `x/a.js` 의 `/a.js` 같은 «남의 부분»을 먹는다.
   * 앞 글자가 따옴표·괄호·공백·`=`·`,` 이거나 문서 처음일 때만 바꾼다.
   */
  const boundaryOk = (prev: string | undefined) =>
    prev === undefined || prev === '"' || prev === "'" || prev === '(' || prev === '='
    || prev === ',' || prev === ' ' || prev === '\n' || prev === '\t';

  let out = '';
  let replaced = 0;
  let i = 0;
  while (i < text.length) {
    let hit: { form: string; local: string } | null = null;
    for (const f of forms) {
      if (f.form === '' || f.form === '/') continue;
      if (!text.startsWith(f.form, i)) continue;
      if (f.rooted && !boundaryOk(i === 0 ? undefined : text[i - 1])) continue;
      hit = f;
      break;
    }
    if (hit === null) { out += text[i]; i += 1; continue; }
    out += hit.local;
    i += hit.form.length;
    replaced += 1;
  }
  // ⛔ 「몇 개가 남았나」를 «센다» — 0 이라고 «말하지» 않는다.
  const missed = (out.match(/https?:\/\//g) ?? []).length;
  return { text: out, replaced, missed };
}

/**
 * ⛔⭐⭐ ***「원격 참조」한 낱말이 «둘»을 덮고 있었다.***
 *
 * 🩸 실측(2026-09-11): 렌더 미러가 「원격 참조 36개 남았다」고 했는데 갈라 보니 —
 *      about.instagram   `a` 16개(바깥 링크) ⊕ 자원 20개
 *      starbucks         `a` 24개(바깥 링크) ⊕ 자원 10개
 *    🔑 ***`<a href>` 는 «원격이어야 맞다»*** — 한 페이지 미러가 바깥 링크까지 로컬로 만들면
 *    그건 재현이 아니라 «거짓말»이다. 그런데 내 수는 그것을 「기댄다」로 셌다.
 * ⇒ 「자원」과 「항해」를 «가른다». 판정은 ***자원만*** 본다.
 */
export type RefKind = 'resource' | 'navigation' | 'other';

/** ⛔ 어느 속성이 «자원»인가 — 값으로 낸다. */
export const RESOURCE_TAGS: readonly string[] = ['img', 'script', 'video', 'audio', 'source', 'iframe', 'embed', 'track', 'object'];

/** ⛔ `<link>` 는 rel 로 갈린다 — stylesheet·preload·icon 은 자원, 나머지(canonical·alternate…)는 아니다. */
export const RESOURCE_LINK_RELS: readonly string[] = ['stylesheet', 'preload', 'icon', 'apple-touch-icon', 'manifest', 'modulepreload'];

/**
 * ⛔⭐⭐ ***`prefetch` 는 「자원」이 아니라 «다음 화면 힌트»다.***
 *
 * 🩸 실측(2026-09-11 · spotify): 남은 «자원» 32 중 **15개**가 `link[prefetch]` 였다.
 *    그것들은 ***이 화면을 그리는 데 «필요 없다»*** — 다음 «화면»을 위해 미리 받아 두라는 힌트다.
 *    안 받아도 이 화면은 똑같이 그려진다. ⇒ 결손으로 세면 ***분모가 오염된다.***
 * ⛔⭐ ***`preload` 는 «다르다»*** — 그것은 ***이 화면의*** 자원이다. 둘을 섞으면 안 된다.
 *    (이름이 비슷해서 섞기 쉽다 — 이 저장소의 ⛔「이름으로 치지 말고 개념으로 쳐라」)
 * ⇒ 「항해」로 센다: 「그 밖」이 아니라 «다음 화면을 향한 것»이기 때문이다.
 */
export const NAVIGATION_HINT_RELS: readonly string[] = ['prefetch', 'dns-prefetch', 'preconnect', 'prerender'];

export function classifyRef(tag: string, rel: string | null): RefKind {
  const t = tag.toLowerCase();
  if (RESOURCE_TAGS.includes(t)) return 'resource';
  if (t === 'link') {
    const rels = (rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rels.some((r) => RESOURCE_LINK_RELS.includes(r))) return 'resource';
    // ⛔ 힌트는 «자원»이 아니다 — 안 받아도 이 화면은 똑같이 그려진다.
    if (rels.some((r) => NAVIGATION_HINT_RELS.includes(r))) return 'navigation';
    return 'other';
  }
  // ⛔ `a`·`form` 은 «항해»다 — 원격인 것이 «맞다».
  if (t === 'a' || t === 'area' || t === 'form') return 'navigation';
  return 'other';
}

export interface RemoteRefTally {
  readonly resource: number;
  readonly navigation: number;
  readonly other: number;
  /**
   * ⛔⭐ ***「안 받았다」와 「받을 게 아니었다」를 가른다.***
   * 주석·조건부 주석·`<script>` 본문·`<template>`·`<noscript>` 안의 원격 «자원» 참조 수.
   * 브라우저가 «애초에 요청하지 않는» 것이라 미러의 결손이 아니다.
   */
  readonly inertResource: number;
  /**
   * ⛔⭐⭐ ***「재생 전에는 «못 받는»」 미디어 후보*** — 원격으로 남은 `<source>` 수.
   *
   * 🩸 실측(2026-09-11 · slack): 남은 원격 «자원» 32 중 **24**가 `<source>` 였고,
   *    그 부모 `<video>` 6개는 전부 `loop muted playsinline poster` — ***autoplay 도 preload 도 «없다»***.
   *    ⇒ 페이지 JS 가 재생 시점을 정하므로 브라우저가 ***애초에 요청하지 않았다***.
   * ⊕ 그 6개의 **poster 는 «전부 로컬»** — ***화면은 안 빈다.*** 빠진 것은 «움직임»뿐이다.
   *
   * ⛔⭐ ***`resource` 에서 «빼지 않는다».*** 재현이 그만큼 원격에 기대는 것은 «사실»이다.
   *    수를 줄이는 것은 오늘 경계한 ***「좋아 보이게 하는」 방향***이다 — 갈라 «말하기»만 한다.
   * ⛔ 그리고 강제로 `video.load()` 를 부르지 «않는다» — `preload` 가 없으면 브라우저가
   *    ***부분(Range)*** 만 받아, 「자기완결」이라 말하면서 ***영상이 깨진다***.
   */
  readonly mediaCandidate: number;
  /** ⛔ 무엇이 남았는지 «표본»을 낸다 — 수만 내면 고칠 데를 못 찾는다. */
  readonly sample: readonly string[];
  /**
   * ⛔⭐⭐ ***내역을 «자가» 낸다 — 곁에 진단 스크립트를 두지 않는다.***
   *
   * 🩸 실측(2026-09-11): 남은 참조를 세는 임시 스크립트를 따로 두었더니
   *    spotify 를 «32」라 했고 자는 «17」이라 했다. ***그 스크립트가 옛 자***였다
   *    (자를 고칠 때 같이 안 고쳤다 — `prefetch` 를 자원으로 세고 `srcset` 을 안 셌다).
   * 🔑 ⇒ ***동기화가 아니라 «없애는» 것이 답이다.*** 자가 하나면 수도 하나다.
   */
  readonly byTag: ReadonlyArray<readonly [string, number]>;
  readonly byHost: ReadonlyArray<readonly [string, number]>;
  /**
   * ⭐ 「지연 속성」(`data-src` 류)에만 남은 원격 참조 수. ⛔ `resource` 에 «안» 더한다.
   *
   * 🩸 왜 갈랐나(2026-09-11 · slack 실측): 옛 판의 `\b(?:src|href)` 가 ***`data-src` 에도 붙었다***
   *    (하이픈 뒤에 단어 경계가 선다). 그래서 cloudfront 이미지 «3개»를 **6개**라고 셌다 —
   *    `src` 한 번 ⊕ `data-srcset` 한 번. ***같은 자원을 속성마다 세고 있었다.***
   * 🔑 그리고 둘은 «다른 사실»이다: `data-src` 는 브라우저가 ***요청조차 안 한다***
   *    (lazysizes 류 JS 가 `src` 로 옮겨야 요청된다). ⇒ 「못 받았다」가 아니라 「아직 안 깨어났다」다.
   * ⚠️ 실측에서 스크롤은 그 JS 를 «발동시킨다»(slack: 68개 중 12→56 이 스왑됐다) —
   *    그래도 안 깨어난 것이 남으면 이 칸에 잡힌다.
   */
  readonly lazyResource: number;
  /**
   * ⭐⭐ ***이 자의 «시야 밖»*** — `LAZY_ATTRS` 에 «없는데» URL 을 담은 `data-*` 속성의 «이름과 곳 수».
   *
   * 🩸 `LAZY_ATTRS` 를 값으로 내면서 「전수가 아니다 — 그 목록이 곧 시야다」라고 «적어 뒀는데»,
   *    적는 것만으로는 목록이 «안 자란다». 📏 미러 5개 실측에서 목록 «밖»의 `data-cdn` 이 나왔다.
   * ⇒ 🔑 추측으로 늘리지 «않고» ***실제 대상이 쓰는 이름을 «보여준다»***.
   * ⛔ 「이것은 lazy 다」라고 ***판정하지 않는다*** — 분석 설정값일 수도 있다. «이름과 수»만 낸다.
   */
  readonly unknownLazy: ReadonlyArray<readonly [string, number]>;
  /**
   * ⭐⭐ 「남은 원격 자원」 중 ***브라우저가 «요청조차 안 한»*** 것.
   *
   * 🩸 2026-09-11 slack 실측 — 남은 `img` 3개를 하나씩 재니 셋 다
   *    `complete:false · naturalWidth:0 · currentSrc:(없음)` 이었고, CDP 네트워크에
   *    그 호스트 요청이 ***스크롤 전후 통틀어 0건***이었다.
   * ⇒ 🔑 ***원본 브라우저도 그것을 안 받는다 — 미러의 «결손이 아니다».***
   *    (`loading="lazy"` ⊕ `class="lazyload"` 가 남아 있었다 — 깨어나지 못한 자리다.)
   * ⛔ 그래서 「남은 원격」을 «두 갈래»로 가른다:
   *      ⓐ 요청했는데 «못 받았다»  → 진짜 결손
   *      ⓑ 요청조차 «안 했다»      → 원본도 안 뜬다 · 분모에서 빼고 읽어야 한다
   * ⚠️ 이 칸은 ***부르는 쪽이 「요청한 URL 집합」을 줄 때만*** 채워진다. 안 주면 `null` —
   *    ⛔ 「0」이 «아니다».
   */
  readonly resourceNeverRequested: number | null;
  /**
   * ⛔⭐ 그 자리의 «이름» — ⛔ 수만 내면 고칠 데를 못 찾는다(이 파일이 이미 두 번 배운 것).
   *    `resourceNeverRequested` 와 «같은 집합»이고, 상한만 걸어 잘라 낸다.
   */
  readonly neverRequestedSample: readonly string[];
  /**
   * ⛔⭐⭐ ***「곳」과 「파일」은 다른 수다.***
   *
   * 🩸 2026-09-11: 산출이 「23곳」이라 말하고 이름을 «몇 개»만 냈는데(상한), 나는 그 둘을 견주고
   *    ***자에 결함이 있다고 지어낼 뻔했다***. ⛔ 사실은 ⑴ 상한이 6이고 ⑵ 내 `grep -A 16` 이 목록을 «잘랐다».
   * ⇒ 그래서 이제 두 수를 «같이» 낸다 — 읽는 쪽이 「29곳 · 17개 파일」을 한눈에 본다.
   */
  readonly resourceFiles: number;
  /**
   * ⭐ 남은 원격 중 ***요청은 «했는데»*** 로컬로 못 옮긴 것 — ⓐ갈래의 «이름»이다.
   * ⛔ `requestedUrls` 를 안 주면 빈 배열 — 「0개」가 아니라 「안 쟀다」다(`resourceNeverRequested === null` 로 가른다).
   */
  readonly requestedButRemainingSample: readonly string[];
}

/**
 * ⛔⭐⭐ ***죽은 마크업을 걷어 낸다 — 브라우저가 «요청하지 않는» 참조는 결손이 아니다.***
 *
 * 🩸 실측(2026-09-11 · starbucks): 자가 「남은 원격 자원 7개」라 했는데 하나씩 열어 보니
 *    ⑴ `<script>` 안의 «자바스크립트 문자열» 1개 — `src="…/banner/'+y.img_NM+'"` 를 태그로 «오독»했다
 *    ⑵ `<!--[if lt IE 9]>` 조건부 주석 안의 html5shiv 1개
 *    ⑶ `<!-- <section class="reserve3Wrap"> … -->` 로 «통째로 주석 처리된» 죽은 절의 img 4개
 *    ⇒ ***진짜 못 받은 자원은 「1개」(구글 애널리틱스)였다.*** 나머지 6은 분모 오염이었다.
 *    반증: `find _r -path '*main/2020*'` → 0개 — 브라우저가 그 넷을 «요청조차 안 했다».
 * 🔑 이 저장소의 ⛔「0과 못 쟀음을 가른다」의 형제 — ***「없다」와 「있을 이유가 없다」는 다른 값이다.***
 *
 * ⛔ 순서가 있다: `<script>` 본문을 «먼저» 지운다. JS 안에 `<!--`·`-->` 가 든 옛 관용구가 있어서
 *    주석을 먼저 지우면 문서 절반이 날아간다.
 * ⛔ 여는 태그는 «남긴다» — `<script src=…>` 자신은 진짜 요청이라 세야 한다.
 */
export function stripInertMarkup(html: string): string {
  return html
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>')
    .replace(/(<style\b[^>]*>)[\s\S]*?<\/style\s*>/gi, '$1</style>')
    .replace(/(<template\b[^>]*>)[\s\S]*?<\/template\s*>/gi, '$1</template>')
    .replace(/(<noscript\b[^>]*>)[\s\S]*?<\/noscript\s*>/gi, '$1</noscript>')
    // ⛔ 조건부 주석(`<!--[if …]> … <![endif]-->`)도 HTML5 에서는 «그냥 주석»이다 — 같이 걷힌다.
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * ⛔⭐⭐ ***«바꾼 뒤의 문서»에서 센다.***
 *
 * 🩸 실측(2026-09-11): 처음엔 이 수를 «라이브 DOM»에서 쟀다. 그런데 rewrite 는 «문자열»에 하고
 *    라이브 페이지는 «안 바뀐다» ⇒ starbucks 를 「원격 자원 158개」로 읽었는데
 *    ***저장된 문서에는 10개***뿐이었다. 계측 «지점»이 틀렸던 것이다.
 * 🔑 ⇒ 자는 «자기가 만든 산출물»을 재야 한다. 원본을 재면 자기 일을 안 센다.
 *
 * ⛔ 여기서 정규식은 «태그와 속성»만 본다 — HTML 을 파싱하지 않는다(그건 못 이긴다).
 *    세는 것이 목적이고, 놓치면 「그 밖」으로 가지 「자원」으로 새지 않는다.
 */
/**
 * ⭐ 「지연 속성」 — 브라우저가 «요청하지 않는» 자리에 든 URL.
 * ⛔ 이름 목록을 «값으로» 낸다: 흔한 lazy 라이브러리 셋(lazysizes · lozad · 자체 구현)이 쓰는 것들.
 *    ⚠️ 전수가 «아니다» — 사이트마다 자기 이름을 쓸 수 있다. 그래서 이 목록이 곧 이 자의 «시야»다.
 */
export const LAZY_ATTRS: readonly string[] = [
  'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy-srcset',
  'data-original', 'data-bg', 'data-background-image',
];
const LAZY_ATTR_RE = new RegExp(
  `(?:^|[\\s"'])(${LAZY_ATTRS.join('|')})\\s*=\\s*["']([^"']*)["']`, 'gi');

/**
 * ⭐⭐ ***시야 «밖»을 세는 자*** — `LAZY_ATTRS` 에 «없는데» URL 을 담은 `data-*`·`lazy-*` 속성.
 *
 * 🩸 2026-09-11: `LAZY_ATTRS` 를 값으로 내면서 *"⚠️ 전수가 아니다 — 사이트마다 자기 이름을 쓴다.
 *    그 목록이 곧 이 자의 «시야»다"* 라고 적었다. ⛔ 적어 두는 것만으로는 «안 자란다».
 *    📏 가진 미러 5개를 훑으니 목록에 «없는» `data-cdn` 이 3곳 나왔다.
 * ⇒ 🔑 목록을 «추측으로» 늘리지 않는다. 대신 ***시야 밖을 «세어 내게» 한다*** —
 *    운영자가 실제 대상에서 본 이름으로 목록을 키우게.
 * ⛔ 「이것은 lazy 다」라고 ***판정하지 않는다*** — 분석 설정값일 수도 있다. «이름과 수»만 낸다.
 */
const UNKNOWN_DATA_URL_RE =
  /(?:^|[\s"'])((?:data|lazy)-[a-z0-9-]+)\s*=\s*["']([^"']{4,})["']/gi;
/** ⛔ 값이 «URL 처럼 생겼나» — 확장자나 스킴이 보일 때만 센다(설정 문자열을 안 센다). */
const URLISH = /(https?:)?\/\/|\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|woff2?)\b/i;

function scanRemote(html: string): {
  resource: number; navigation: number; other: number; mediaCandidate: number; lazyResource: number;
  sample: string[]; byTag: Array<readonly [string, number]>; byHost: Array<readonly [string, number]>;
  /** ⭐ 「남은 원격 자원」의 URL 들 — 「요청했나」를 견주려면 수가 아니라 «이름»이 있어야 한다. */
  resourceUrls: string[];
  unknownLazy: Array<readonly [string, number]>;
} {
  const out = { resource: 0, navigation: 0, other: 0 };
  let mediaCandidate = 0;
  /** ⭐ 지연 속성(`data-src` 류)에만 있는 원격 참조. ⛔ `resource` 에 «안» 더한다 — 다른 사실이다. */
  let lazyResource = 0;
  const tags = new Map<string, number>();
  const hosts = new Map<string, number>();
  /** ⭐ 시야 밖 — 이름별 «곳» 수. ⛔ 판정하지 않는다. */
  const unknownLazy = new Map<string, number>();
  const sample: string[] = [];
  const resourceUrls: string[] = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    // ⛔⭐⭐ 🩸 ***`\b` 가 하이픈 «뒤»에도 선다*** — `data-src` 가 `src` 로, `data-srcset` 이 `srcset` 으로 잡혔다.
    //    📏 2026-09-11 slack 실측: cloudfront 이미지가 문서에 **3개**인데 집계는 **6개**라고 말했다
    //       (`src` 한 번 ⊕ `data-srcset` 한 번). ⇒ ***같은 자원을 속성마다 세고 있었다.***
    //    ⛔ 그리고 「지연 속성」과 「살아 있는 속성」은 «다른 사실»이다:
    //       `data-src` 는 브라우저가 «요청조차 안 한다»(lazysizes 류 JS 가 옮겨야 요청된다).
    //    ⇒ ✅ ⓐ 속성 이름을 «정확히» 맞추고 ⓑ 지연 속성은 «따로» 세며 ⓒ URL 을 «중복 제거»한다.
    const urlM = /(?:^|[\s"'])(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/i.exec(attrs);
    // ⛔⭐⭐ 🩸 ***자가 `srcset` 을 «안 세고» 있었다*** (2026-09-11 실측).
    //    slack 의 원격 srcset 후보 **64개**가 「남은 원격」에 «한 번도» 안 잡혔다.
    //    🔑 오늘 반복된 「분모 오염」의 ***반대 방향*** — ***「있는데 안 세는」*** 것이고,
    //       그쪽이 더 나쁘다: 수가 «좋아 보이는 쪽»으로 틀린다.
    const setM = /(?:^|[\s"'])(?:srcset|imagesrcset)\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const setRemote = setM === null ? [] : splitSrcsetCandidates(setM[1]!).filter((u) => /^(https?:)?\/\//i.test(u));
    // ⭐ 지연 속성 — 브라우저가 «요청하지 않는» 원격 참조. ⛔ 「없다」가 아니라 「다른 종류」다.
    // ⭐ 시야 «밖» — `LAZY_ATTRS` 에 없는데 URL 을 담은 `data-*`. ⛔ 이름과 수만 센다.
    for (const um of attrs.matchAll(UNKNOWN_DATA_URL_RE)) {
      const name = um[1]!.toLowerCase();
      if (LAZY_ATTRS.includes(name)) continue;
      if (!URLISH.test(um[2]!)) continue;
      unknownLazy.set(name, (unknownLazy.get(name) ?? 0) + 1);
    }
    const lazyRemote: string[] = [];
    for (const lm of attrs.matchAll(LAZY_ATTR_RE)) {
      const raw = lm[2]!;
      for (const u of (lm[1]!.toLowerCase().endsWith('srcset') ? splitSrcsetCandidates(raw) : [raw])) {
        if (/^(https?:)?\/\//i.test(u)) lazyRemote.push(u);
      }
    }
    if (urlM === null && setRemote.length === 0 && lazyRemote.length === 0) continue;
    const relM = /\brel\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const kind = classifyRef(tag, relM === null ? null : relM[1]!);
    // ⛔ 「태그 하나」가 아니라 「원격 참조 몇 개」로 센다 — srcset 은 한 태그에 여럿이다.
    // ⛔⭐ 다만 ***한 태그 안에서 «같은 URL» 은 한 번만 센다*** — `src` 와 `srcset` 이 같은 파일을
    //    가리키는 것은 «흔하고», 그것을 둘로 세면 결손이 «두 배로 보인다».
    const liveUrls = new Set<string>([...(urlM === null ? [] : [urlM[1]!]), ...setRemote]);
    const lazyUrls = new Set<string>(lazyRemote.filter((u) => !liveUrls.has(u)));
    out[kind] += liveUrls.size;
    if (kind === 'resource') lazyResource += lazyUrls.size;
    // ⛔ 갈라 «세기만» 한다 — `resource` 에서 빼지 않는다.
    if (kind === 'resource' && tag === 'source') mediaCandidate += liveUrls.size;
    const shown = urlM?.[1] ?? setRemote[0] ?? [...lazyUrls][0];
    if (kind === 'resource' && shown !== undefined && sample.length < 5) sample.push(`${tag} ${shown.slice(0, 60)}`);
    // ⛔ 「자원」만 내역으로 센다 — 항해·그 밖은 결손이 아니다.
    if (kind === 'resource') {
      const relTag = tag === 'link' && relM !== null ? `link[${relM[1]!.trim().toLowerCase()}]` : tag;
      tags.set(relTag, (tags.get(relTag) ?? 0) + liveUrls.size);
      for (const u of liveUrls) {
        resourceUrls.push(u);
        let host = '?';
        try { host = new URL(u.startsWith('//') ? `https:${u}` : u).host; } catch { /* 못 읽으면 물음표 */ }
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
      }
    }
  }
  const desc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { ...out, mediaCandidate, lazyResource, sample, resourceUrls, unknownLazy: desc(unknownLazy), byTag: desc(tags), byHost: desc(hosts) };
}

/**
 * ⛔ URL 을 «비교 가능한» 모양으로. 프로토콜 생략(`//host/…`)과 조각(`#…`)만 고른다.
 *    ⚠️ 질의는 «남긴다» — 다른 질의는 다른 자원이다.
 */
/** ⛔ 이름을 «몇 개»까지 낼지 — 값으로 낸다. 전부 내면 산출이 목록에 잠긴다. */
export const REMOTE_SAMPLE_CAP = 6;

function comparableUrl(raw: string): string {
  const withScheme = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const u = new URL(withScheme);
    u.hash = '';
    return u.toString();
  } catch { return withScheme; }
}

export function countRemoteRefs(
  html: string,
  /** ⭐ 브라우저가 «요청한» URL 들. 안 주면 `resourceNeverRequested` 가 `null` 이다(0 이 아니다). */
  requestedUrls?: Iterable<string>,
): RemoteRefTally {
  const live = scanRemote(stripInertMarkup(html));
  const raw = scanRemote(html);
  // ⛔ 음수를 못 낸다 — 죽은 절을 걷어 내면 «줄기만» 한다.
  const inertResource = Math.max(0, raw.resource - live.resource);
  let resourceNeverRequested: number | null = null;
  let neverRequestedSample: string[] = [];
  let requestedButRemainingSample: string[] = [];
  if (requestedUrls !== undefined) {
    const asked = new Set<string>();
    for (const u of requestedUrls) asked.add(comparableUrl(u));
    // ⛔ 중복 URL 은 «한 번»만 이름을 댄다 — 같은 파일을 네 줄로 내면 읽는 쪽이 넷이라고 읽는다.
    const never: string[] = [], got: string[] = [];
    for (const u of new Set(live.resourceUrls)) (asked.has(comparableUrl(u)) ? got : never).push(u);
    resourceNeverRequested = live.resourceUrls.filter((u) => !asked.has(comparableUrl(u))).length;
    neverRequestedSample = never.slice(0, REMOTE_SAMPLE_CAP);
    requestedButRemainingSample = got.slice(0, REMOTE_SAMPLE_CAP);
  }
  return {
    ...live, inertResource, resourceNeverRequested, neverRequestedSample, requestedButRemainingSample,
    resourceFiles: new Set(live.resourceUrls.map(comparableUrl)).size,
    sample: live.sample,
  };
}

/**
 * ⛔⭐⭐⭐ ***자원을 로컬로 옮기면, 「원격 출처」를 전제한 속성들이 «거짓»이 된다.***
 *
 * 🩸 실측(2026-09-11 · about.instagram): 미러가 ✅ self-contained 였는데
 *    `file://` 로 열면 ***CSS 가 하나도 안 먹었다***(Times 세리프로 그려졌다).
 *    ⛔ 그런데 `http://127.0.0.1` 로 열면 «멀쩡했다» — 그래서 「미러가 잘못됐다」로 오진하기 쉽다.
 * 🔑 범인은 `<link rel="stylesheet" crossorigin="anonymous">` 63곳.
 *    `file://` 은 출처가 `null` 이라 CORS 요청이 «거부»된다. 원본에선 맞는 속성이었고,
 *    ***자원을 옮긴 «순간» 틀린 속성이 됐다.***
 * ⊕ `integrity` 도 같은 족속이다 — 참조를 바꾸면 해시가 안 맞아 «조용히» 막힌다.
 *
 * ⛔ `charset` 도 같은 축이다: 원본은 HTTP 헤더로 `charset=utf-8` 을 «받는데»
 *    파일로 저장하면 그 헤더가 «없다» ⇒ 브라우저가 windows-1252 로 읽어 `you’re` 가 `youâ€™re` 가 된다.
 *    📏 실측: starbucks 는 문서에 `<meta charset>` 이 «있어» 멀쩡했고, instagram 은 «없어» 깨졌다.
 */
export const LOCALIZED_STALE_ATTRS: readonly string[] = ['crossorigin', 'integrity'];

export interface LocalizeResult {
  readonly text: string;
  /** 뗀 속성 수 — 종류별. */
  readonly stripped: { readonly [k: string]: number };
  /** charset 선언을 «넣었나». 이미 있었으면 false. */
  readonly charsetInserted: boolean;
}

/**
 * ⛔ 정규식은 «그 속성만» 본다 — 값 안의 따옴표까지 파싱하지 않는다.
 *    놓치면 옛 동작(그대로 둠)으로 떨어지지, 문서를 망가뜨리지 않는다.
 */
export function localizeDocument(html: string): LocalizeResult {
  const stripped: Record<string, number> = {};
  let text = html;
  for (const attr of LOCALIZED_STALE_ATTRS) {
    // 값 있는 형태(`a="b"` · `a='b'` · `a=b`)와 «홑» 형태(`crossorigin`)를 함께 본다.
    const re = new RegExp(`\\s${attr}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?(?=[\\s/>])`, 'gi');
    let n = 0;
    text = text.replace(re, () => { n += 1; return ''; });
    if (n > 0) stripped[attr] = n;
  }
  // ⛔ 이미 있으면 «안 건드린다» — 원본의 선언을 내 것으로 덮지 않는다.
  const hasCharset = /<meta[^>]*\bcharset\b/i.test(text);
  let charsetInserted = false;
  if (!hasCharset) {
    const headM = /<head\b[^>]*>/i.exec(text);
    if (headM !== null) {
      const at = headM.index + headM[0].length;
      text = `${text.slice(0, at)}<meta charset="utf-8">${text.slice(at)}`;
      charsetInserted = true;
    }
  }
  return { text, stripped, charsetInserted };
}

/**
 * ⛔⭐⭐⭐ ***`@font-face` 의 `src:` 후보 중 «못 받은 것»을 지운다.***
 *
 * 🩸 실측(2026-09-11 · about.instagram): CSS 안의 참조를 «제대로» 바꾸고 나서도
 *    화면이 여전히 ***Times 세리프***였다. `document.fonts` 는 **7개 선언 · 0개 로드**였다.
 * 🔑 CSS 는 이렇게 적혀 있었다:
 *      `src: url(…LwNYcxufeAO.ttf) format("truetype"), url(…4QCyqhX8hVM.woff) format("woff"),`
 *      `     url(…_a_FWcDLOaW.woff2) format("woff2")`
 *    미러가 받은 것은 ***ttf 하나뿐***이라 그것만 로컬로 바뀌고 나머지는 원격 경로로 남았다.
 *    ⛔ 그런데 ***브라우저는 woff2 를 «먼저» 고른다*** — 그 후보가 죽어 있으면
 *    ***그 face 가 통째로 실패한다.*** 「하나는 살아 있으니 괜찮겠지」가 «아니다».
 * ⇒ 로컬로 못 바뀐 후보를 «지워» 살아 있는 것만 남긴다.
 * ⛔ 하나도 안 남으면 «건드리지 않는다» — 그 face 는 원래 못 산다(거짓 수리를 만들지 않는다).
 */
export function pruneDeadFontSources(css: string): { readonly text: string; readonly pruned: number } {
  let pruned = 0;
  // ⛔ 정규식으로 값을 «끊지» 않는다 — 🩸 `url(data:font/woff2;base64,…)` 의 `;` 에서 잘렸다
  //    (내 시험이 잡았다). 괄호 «깊이»를 보며 훑는다.
  const text = replaceSrcDeclarations(css, (list: string) => {
    if (!/url\(/i.test(list)) return null;
    const parts = splitTopLevel(list);
    const alive = parts.filter((part) => {
      const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(part);
      if (m === null) return true;                 // ⛔ 못 읽으면 «남긴다»
      const href = m[2]!.trim();
      if (href.startsWith('data:')) return true;
      // 로컬로 바뀐 것 = 되짚기(`../`)로 시작하거나 미러 뿌리(`_r/`)로 시작한다.
      return href.startsWith('../') || href.startsWith(`${MIRROR_ROOT}/`);
    });
    if (alive.length === 0 || alive.length === parts.length) return null;
    pruned += parts.length - alive.length;
    return alive.join(',');
  });
  return { text, pruned };
}

/**
 * `src:` 선언의 «값»을 괄호 깊이로 찾아 돌려준 값으로 바꾼다.
 * ⛔ `null` 을 돌려주면 «안 건드린다». 값은 `;` 나 `}` 에서 끝나되 ***괄호 «밖»의 것***만 본다.
 */
function replaceSrcDeclarations(css: string, transform: (list: string) => string | null): string {
  let out = '';
  let i = 0;
  const re = /(^|[;{\s])(src)\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const valueStart = m.index + m[0].length;
    let depth = 0;
    let j = valueStart;
    for (; j < css.length; j += 1) {
      const c = css[j];
      if (c === '(') depth += 1;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if ((c === ';' || c === '}') && depth === 0) break;
    }
    const list = css.slice(valueStart, j);
    const next = transform(list);
    if (next === null) continue;
    out += css.slice(i, valueStart) + next;
    i = j;
    re.lastIndex = j;
  }
  return out + css.slice(i);
}

/** ⛔ 괄호 «안»의 콤마로 자르면 안 된다 — `local(A, B)`·`format(…)` 이 있다. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * ⛔⭐⭐ ***`<video>`/`<audio>`/`<picture>` 의 `<source>` 형제 중 «못 받은 것»을 지운다.***
 *
 * 🩸 실측(2026-09-11 · slack): 남은 «자원» 84 중 ***79개가 `<source>`*** 였다.
 *    `<video>` 30개에 `<source>` 110개(로컬 31 · 원격 79) — 브라우저는 ***한 후보만*** 받는다.
 *    나머지는 요청조차 안 되니 받을 수도, 바꿀 수도 없다.
 * 🔑 `@font-face src:` 와 ***정확히 같은 족속***이다 — ***후보가 여럿인 계약***.
 *    ⊕ 그런데 폰트와 «다른 점»이 하나 있다: 폰트는 죽은 후보가 face 를 죽이지만,
 *    `<source>` 는 브라우저가 «지원하는 첫 것»을 고르므로 죽은 후보가 있어도 재생은 된다.
 *    ⇒ 여기서 지우는 이유는 ***재생이 아니라 「재현이 원격에 기대지 않게」***다.
 * ⛔ 로컬 후보가 «하나도» 없는 부모는 ***건드리지 않는다*** — 폰트와 같은 규칙(거짓 수리 금지).
 *    📏 slack 실측: 30개 중 24개가 로컬 후보를 가졌고, 나머지 6개의 원격 24개는 «남긴다».
 */
export const SOURCE_PARENTS: readonly string[] = ['video', 'audio', 'picture'];

export function pruneDeadMediaSources(html: string): { readonly text: string; readonly pruned: number } {
  let pruned = 0;
  const parents = SOURCE_PARENTS.join('|');
  const re = new RegExp(`<(${parents})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
  const text = html.replace(re, (block) => {
    const sources = block.match(/<source\b[^>]*>/gi) ?? [];
    if (sources.length < 2) return block;
    const isLocal = (tag: string) => {
      const m = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag);
      if (m === null) return true;                       // ⛔ 못 읽으면 «남긴다»
      const href = m[1]!.trim();
      if (href.startsWith('data:')) return true;
      return !/^(https?:)?\/\//i.test(href);
    };
    const alive = sources.filter(isLocal);
    // ⛔ 하나도 안 남으면 «건드리지 않는다» — 그 미디어는 원래 못 산다.
    if (alive.length === 0 || alive.length === sources.length) return block;
    let out = block;
    for (const tag of sources) {
      if (isLocal(tag)) continue;
      out = out.replace(tag, '');
      pruned += 1;
    }
    return out;
  });
  return { text, pruned };
}

/**
 * ⛔ `srcset` 후보를 자른다. ⛔ 서술자(`2x`·`300w`)는 «떼고» URL 만 낸다.
 *    ⛔ 괄호 안 콤마는 없지만 공백 서술자가 있으니 첫 낱말만 본다.
 */
export function splitSrcsetCandidates(value: string): string[] {
  return value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '').filter((u) => u.length > 0);
}

/**
 * ⛔⭐⭐ ***`srcset` 도 「후보가 여럿인 계약」이다*** — 오늘 네 번째.
 *
 * 🩸 실측(2026-09-11 · slack): `srcset` 태그 71개 · 후보 133(로컬 69 · 원격 64),
 *    그중 ***62개 태그가 「섞여」 있었다***(로컬과 원격이 «한 태그 안»에).
 *    브라우저는 화면 밀도·폭에 맞는 «한 후보»만 받으므로 나머지는 요청조차 안 된다.
 * ⛔ 로컬 후보가 «하나도» 없으면 건드리지 않는다 — 폰트·`<source>` 와 «같은 규칙».
 *    📏 slack 에서 그런 태그는 2개였고, 그 둘은 `src` 도 원격이라 ***정말로 못 살린다***.
 */
export function pruneDeadSrcset(html: string): { readonly text: string; readonly pruned: number } {
  let pruned = 0;
  const text = html.replace(/\b(srcset|imagesrcset)\s*=\s*"([^"]*)"/gi, (whole, attr: string, value: string) => {
    const parts = value.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length < 2) return whole;
    const isLocal = (part: string) => {
      const u = part.split(/\s+/)[0] ?? '';
      if (u.startsWith('data:')) return true;
      return !/^(https?:)?\/\//i.test(u);
    };
    const alive = parts.filter(isLocal);
    if (alive.length === 0 || alive.length === parts.length) return whole;
    pruned += parts.length - alive.length;
    return `${attr}="${alive.join(', ')}"`;
  });
  return { text, pruned };
}

export interface MirrorVerdict {
  readonly kind: 'self-contained' | 'partial' | 'empty';
  readonly resources: number;
  readonly remoteLeft: number;
  /** ⭐ 그중 「요청은 했는데 못 옮긴」 수. ⛔ `null` 은 «안 쟀다» — 0 이 아니다. */
  readonly fixableLeft: number | null;
  readonly why: string;
}

/**
 * ⛔ 「자기완결인가」를 «세어» 낸다 — 주장으로 두지 않는다.
 * ⛔⭐ `remoteLeft` 는 ***«자원»만*** 세야 한다 — `<a>` 바깥 링크는 원격인 것이 «맞다».
 *    🩸 첫 판은 둘을 뭉개서 starbucks 를 「34개 기댄다」로 읽었는데 실제 자원은 «10개»였다.
 *
 * ⛔⭐⭐ 2026-09-11 — ***「요청조차 안 한 것」을 분모에서 뺄지***를 놓고 잰 결과를 여기 적는다.
 *
 * 🩸 내 가설은 「빼면 «게임된다» — 덜 훑으면 lazy 가 안 깨어나 never-requested 가 늘고 점수가 좋아진다」였다.
 *    ⇒ 반증을 쐈다(slack · `--scroll-steps 12` ↔ `1`):
 *      ```
 *      제대로 훑음  받은 140 · 남은 29곳 · 요청조차 안 함 23  ⇒ 뺀 수 «6»
 *      덜   훑음   받은 113 · 남은 117곳 · 요청조차 안 함 107 ⇒ 뺀 수 «10»
 *      ```
 *    🚨 ***가설이 틀렸다*** — 덜 훑으면 뺀 수도 «나빠진다»(6 → 10). 게임되지 «않는다».
 *
 * ✅ 그래도 **판정은 안 바꿨다** — 이유가 «게임」이 아니라 ***물음이 둘이기 때문***이다:
 *    ⓐ `self-contained` 가 답하는 것 = ***「문서가 원격을 «가리키나»」*** — 잠재 참조도 «가리킨다».
 *    ⓑ 「미러가 더 잘할 수 있었나」 = ***「요청했는데 못 받은 수」*** — 이것은 «다른 축»이다.
 *    ⇒ 그래서 판정은 ⓐ 를 «보수적으로» 유지하고, ⓑ 를 `fixableLeft` 로 «같이» 낸다.
 * ⛔ 다음 사람에게: ***「빼면 게임된다」는 이유로 이 결정을 설명하지 마라 — 그 이유는 반증됐다.***
 */
export function judgeMirror(
  resources: number,
  remoteResourceLeft: number,
  navigationLeft = 0,
  /** ⭐ 그중 ***요청은 «했는데»*** 못 옮긴 수 — 「미러가 고칠 수 있는」 몫. ⛔ `null` 이면 «안 쟀다»(0 이 아니다). */
  fixableLeft: number | null = null,
): MirrorVerdict {
  const tail = navigationLeft > 0 ? ` (바깥 링크 ${navigationLeft}개는 «원격이 맞다» — 세지 않았다)` : '';
  // ⛔ 판정 «줄»이 두 수를 다 말한다 — 총수만 내면 읽는 쪽이 「전부 결손」으로 읽는다.
  const fixTail = fixableLeft === null
    ? ''
    // ⛔⭐ 🩸 음수는 ***「두 수가 «다른 측정»에서 왔다」***는 뜻이다 — 실제로 내 탐침이 그렇게 섞어
    //    `-78개` 를 내게 했다(2026-09-11). ⛔ 0 으로 «몰지» 않는다 — 몰면 그럴듯해져서 안 보인다.
    //    ⇒ 「모순이다」라고 «말한다». 이 저장소의 ⛔「0」과 「못 쟀음」을 가른다 의 형제다.
    : fixableLeft < 0
      ? ` 🚨 ***수가 «모순»이다*** — 「고칠 수 있는 것」이 ${fixableLeft}개로 나왔다(음수).`
        + ' 남은 원격과 「요청조차 안 한 수」가 «다른 측정»에서 온 것이다 — 둘을 같은 판에서 세라'
      : fixableLeft === remoteResourceLeft
        ? ''
        : ` ⊕ ***그중 «고칠 수 있는» 것은 ${fixableLeft}개***(나머지는 브라우저가 요청조차 안 했다)`;
  if (resources === 0) {
    return { kind: 'empty', resources, remoteLeft: remoteResourceLeft, fixableLeft, why: '받은 자원이 «하나도 없다» — 브라우저가 못 열었을 수 있다' };
  }
  if (remoteResourceLeft === 0) {
    return { kind: 'self-contained', resources, remoteLeft: 0, fixableLeft, why: `자원 ${resources}개를 전부 로컬로 바꿨다${tail}` };
  }
  return {
    kind: 'partial', resources, remoteLeft: remoteResourceLeft, fixableLeft,
    why: `자원 ${resources}개를 받았지만 «원격 자원 ${remoteResourceLeft}개»가 남았다 — 그만큼은 재현이 원격에 기댄다${fixTail}${tail}`,
  };
}

/** ⛔ 못 담는 것을 «값»으로 낸다. */
export const RENDER_MIRROR_BLIND_SPOTS: readonly string[] = [
  'js-constructed-url: JS 가 «런타임에 만드는» URL 은 문자열 치환으로 «원리상» 못 바꾼다'
    + ' — 문서가 자기완결이어도 «실행»이 원격을 부를 수 있다(재는 자 = check-mirror-runtime)',
  'after-interaction: 누른 «뒤에» 받는 자원은 안 담긴다 — 이 자는 첫 렌더까지만 본다',
  'lazy-below-fold: 스크롤해야 받는 이미지는 «안 받는다»(뷰포트 밖)',
  'service-worker: 워커가 캐시에서 주면 네트워크 이벤트가 «안 뜬다»',
  'media-range: 영상은 부분 요청(Range)이라 «온전한 파일»이 아닐 수 있다',
  'cors-opaque: 교차출처 불투명 응답은 본문을 «못 읽는다»',
];
