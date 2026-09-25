/**
 * 🛬 **「가려던 곳」과 「실제로 간 곳」을 견준다** — ⛔ 「같나」가 아니라 ***「얼마나 갈렸나」***를 낸다.
 *
 * 🚨 **계기(2026-08-28 · 측정이 «설계의 전제»를 반박했다)**:
 *    `#13644` 는 「이동(`<a href>`)만 누른다」로 되돌릴 수 없는 조작을 좁혔다. 그 근거는
 *    ***「이동은 어디로 가는지 «안다»」***였다. 그런데 `#13704` 로 목적지를 재 보니 —
 *
 *    ```
 *    측정 가능한 클릭 11건 중 ***8건***이 링크가 말한 곳과 «다른 데» 착지했다
 *       https://iana.org/domains/example  →  https://www.iana.org/help/example-domains
 *    ```
 *    ⇒ 🔑 ***「이동만 누른다」는 「어디로 갈지 안다」를 «뜻하지 않는다».***
 *
 * ⭐ 그래서 「같다/다르다」로 접지 않고 «갈래»로 낸다 — 리다이렉트는 «정상»이고,
 *    ***다른 사이트로 가는 것***만 놀랄 일이다. ⛔ 정상을 빨강으로 만들면 아무도 안 본다.
 */

export type LandingVerdict =
  /** 링크가 말한 그대로 갔다. */
  | 'exact'
  /** 같은 사이트인데 «경로»가 바뀌었다 — 흔한 리다이렉트. */
  | 'same-host'
  /** `www` 만 붙거나 떨어졌다 — 사실상 같은 사이트. */
  | 'www-only'
  /** ⛔ ***링크가 말한 사이트가 아니다.*** 되돌릴 수 없는 축에서 이것만 놀랄 일이다. */
  | 'cross-host'
  /**
   * ⛔⭐ ***이 페이지가 «안 움직였다»*** — 링크는 다른 곳을 가리켰는데 우리는 출발지에 그대로 있다.
   * 📏 실물(2026-08-28 · 로컬 브라우저): `target="_blank"` 링크를 누르면 «새 탭»이 열리고
   *    이 페이지는 «가만히» 있는다. 그런데 옛 판정기는 그것을 `same-host`(경로가 바뀌었다)로 읽었다 —
   *    ***이동이 «아예 없었는데»*** 리다이렉트처럼 보였다.
   */
  | 'did-not-move'
  /** ⛔ 「안 갈렸다」가 아니라 «잴 수 없었다» — 이동이 아니었거나 옛 행이다. */
  | 'unmeasured';

export interface LandingAssessment {
  verdict: LandingVerdict;
  detail: string;
  /** ⛔ 이것만 「놀랄 일」이다 — 나머지는 사실이지 결함이 아니다. */
  surprising: boolean;
}

/** `www.` 접두를 뗀 호스트. ⛔ `lstrip` 류로 «글자»를 떼면 `wwwx.com` 이 망가진다 — 접두로만 뗀다. */
function bareHost(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** 두 주소가 «사실상 같은 자리»인가. ⛔ 끝의 `/` 하나로 다르다고 하지 않는다. */
function sameLocation(a: string, b: string): boolean {
  const trim = (u: string) => u.replace(/\/+$/, '');
  return trim(a) === trim(b);
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    // ⛔ hostname 만 보면 javascript:/file: 이 허용 호스트와 «같다»고 통과한다 — http(s) 만 호스트다.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param startedUrl 이 조작이 «출발한» 주소. ⛔ 주면 「이 페이지가 안 움직였다」를 가를 수 있다.
 *   안 주면 그 갈래를 «안 만든다» — 없는 정보로 판정을 지어내지 않는다.
 */
export function assessLanding(clickedHref: unknown, landedUrl: unknown, startedUrl?: unknown): LandingAssessment {
  const href = typeof clickedHref === 'string' && clickedHref !== '' ? clickedHref : null;
  const landed = typeof landedUrl === 'string' && landedUrl !== '' ? landedUrl : null;
  if (href === null || landed === null) {
    // ⛔ 어느 쪽이 없는지를 «말한다» — 뭉치면 다음 창이 처음부터 다시 잰다.
    const missing = href === null && landed === null ? '둘 다' : href === null ? '가려던 곳이' : '간 곳이';
    // ⛔⭐ 「왜 없나」를 «갈라» 말한다 — 📏 실물: 폼 버튼(제출)은 href 가 «구조적으로» 없다.
    //    ⇒ 그 경우 「가려던 곳 ↔ 간 곳」 대조는 ***원리상 못 한다*** — 남는 증거는 landedUrl 뿐이다.
    const why = href === null && landed !== null
      ? ' — 버튼·제출처럼 href 가 «없는» 클릭이거나, 그 값을 안 싣던 옛 행이다(대조는 원리상 불가)'
      : ' — 이동이 아니었거나 그 값을 안 싣던 옛 행이다';
    return { verdict: 'unmeasured', surprising: false, detail: `${missing} «없다»${why}` };
  }

  // ⛔ 스킴을 못 읽으면 exact/did-not-move 보다 먼저 unmeasured — javascript: 가
  //    href===landed 이거나 출발지와 같아도 «같은 곳»이 아니다.
  const a = hostOf(href);
  const b = hostOf(landed);
  if (a === null || b === null) {
    return { verdict: 'unmeasured', surprising: false, detail: `URL 을 «못 읽었다» — ${a === null ? href.slice(0, 60) : landed.slice(0, 60)}` };
  }

  if (href === landed) return { verdict: 'exact', surprising: false, detail: '링크가 말한 그대로 갔다' };

  // ⛔⭐ 「이 페이지가 «안 움직였다»」를 리다이렉트와 뭉치지 않는다 — 축이 다르다.
  //    ⚠️ 출발지를 «안 주면» 이 갈래를 만들지 않는다(없는 정보로 지어내지 않는다).
  const started = typeof startedUrl === 'string' && startedUrl !== '' ? startedUrl : null;
  if (started !== null && sameLocation(landed, started)) {
    return {
      verdict: 'did-not-move',
      surprising: false,
      detail: `링크는 ${href.slice(0, 60)} 를 가리켰는데 ***이 페이지는 «안 움직였다»***`
        + ' — 새 탭이 열렸거나(target=_blank) 클릭이 이동을 «안 일으켰다»',
    };
  }
  if (a === b) return { verdict: 'same-host', surprising: false, detail: `같은 사이트인데 경로가 바뀌었다: ${landed.slice(0, 90)}` };
  if (bareHost(a) === bareHost(b)) return { verdict: 'www-only', surprising: false, detail: `www 만 다르다(${a} → ${b})` };
  return {
    verdict: 'cross-host',
    surprising: true,
    detail: `⛔ 링크는 ${a} 라 했는데 ${b} 에 «있다» — 되돌릴 수 없는 조작에서 이것은 놀랄 일이다`,
  };
}
