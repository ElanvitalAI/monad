/**
 * 🚧 **행동 경계 — 「이 봇이 «어디서» 손을 쓸 수 있나」**
 *
 * 🚨 **왜 이것이 C5(「쓴다」)의 다음 칸인가** (2026-08-28):
 *    대표 이 「쓴다」를 승인했고, 그 축은 ***되돌리기 장치가 «없다»***.
 *    `#13644` 는 「이동만 누른다」로 좁혔고 그 근거는 ***「이동은 어디로 갈지 «안다»」***였다.
 *    ⛔ 그런데 `#13711` 이 그것을 반증했다 — 측정 가능한 클릭 11건 중 ***8건***이 다른 데 착지했다.
 *
 * > ### 🔑 ***되돌릴 수 없으면 남는 것은 «경계»다.***
 * > 그리고 우리는 ***누르기 «전»에 href 를 이미 읽는다***(`#13704`) — 그러니 경계를 «사전»에 건다.
 * > ⛔ 착지 «뒤»에 아는 것은 경보이지 방지가 «아니다».
 *
 * ⚖️ **선언이 «없으면» 막지 않는다** — 대신 그렇다고 «말한다».
 *    ⛔ 기본을 「거부」로 두면 오늘 도는 루틴이 «전부» 멎고, 그러면 아무도 이 축을 안 쓴다.
 *    ⇒ 먼저 ***「경계 없이 도는 조작이 몇 건인가」를 «세고»***, 그 수를 보고 조인다(관측 먼저).
 */

export type BoundaryVerdict =
  /** 선언된 경계 «안»이다. */
  | 'inside'
  /** ⛔ 경계 «밖»이다 — 누르기 전에 막는다. */
  | 'outside'
  /** ⚠️ 경계가 «선언되지 않았다» — 막지 않지만 「어디로든 갈 수 있다」는 뜻이다. */
  | 'undeclared'
  /**
   * 🆕 ***목적지가 경계 밖인 «이동»인데, 그 봇이 「나는 바깥을 읽는다」를 «명시»했다.***
   *
   * ⛔ 이것을 `inside` 로 접지 않는 것이 요점이다 — 경계를 «넘은» 사건이라 ***셀 수 있어야*** 한다.
   *    ⇒ 방지가 아니라 «계수»다. 「몇 번 넘었나」를 사람이 못 세면 이 축은 조용히 넓어진다.
   */
  | 'offsite-navigation';

export interface BoundaryDecision {
  verdict: BoundaryVerdict;
  /** ⛔ `verdict` 와 «따로» 둔다 — 「밖이다」와 「막는다」는 정책이 갈릴 수 있다. */
  allowed: boolean;
  detail: string;
}

/**
 * 선언 한 줄이 무엇을 무는가.
 * ```
 *   example.com     ⇒ 그 호스트 «하나». www. 는 같은 것으로 본다.
 *  .example.com     ⇒ 그 호스트 ⊕ ***하위 도메인***.  ⛔ 점을 «명시»해야 열린다.
 * ```
 * ⛔ 하위 도메인을 «암묵»으로 열지 않는다 — `evil-example.com` 같은 것이 새어 들어온다.
 */
function hostMatches(host: string, rule: string): boolean {
  const h = host.toLowerCase();
  const r = rule.trim().toLowerCase();
  if (r === '') return false;
  if (r.startsWith('.')) {
    const base = r.slice(1);
    return h === base || h.endsWith(`.${base}`);
  }
  const bare = (x: string) => (x.startsWith('www.') ? x.slice(4) : x);
  return bare(h) === bare(r);
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
 * 🆕 ***목적지를 «미리 못 적는» 봇이 있다*** — 그것을 정직하게 다루는 축.
 *
 * 🚨 계기(RFC §23b-2 · 2026-08-28): `newsbot` 의 「그날 첫 기사로 들어간다」는
 *    ***`actionHosts` 로 «원리상» 못 좁힌다*** — 목적지가 매일 바뀐다(오늘 `blog.cloudflare.com`).
 *    좁히면 매일 막히고, 넓히면 경계가 «사라진다».
 *
 * ⚖️ **그래서 「기본을 약하게」가 아니라 「그 봇이 «말하게»」로 답한다**(2026-08-29 · 36차):
 * ```
 * blocked (기본)  목적지도 경계 안이어야 한다 — 지금까지와 «똑같다». 아무 봇도 조용히 넓어지지 않는다
 * allowed         ***이동(<a href>)에 한해*** 목적지가 밖이어도 «누른다». 대신 verdict 가
 *                 `offsite-navigation` 으로 남아 ***셀 수 있다***
 * ```
 * ⛔⭐ **`allowed` 여도 «이동이 아닌» 클릭에는 안 먹는다** — 제출·버튼·모르는 것은 그대로 목적지 검사를 받는다.
 *    ⇒ 넓어지는 것은 ***「읽으러 나가는 것」*** 하나뿐이다.
 * ⚠️ **그리고 이것이 「안전」을 뜻하지 않는다** — 이 모듈 머리말대로 ***이동조차 부작용을 낼 수 있다***
 *    (GET 으로 지우는 사이트). 이 값은 「그 위험을 그 봇이 «떠안겠다»고 적었다」는 기록이다.
 */
export type OffsiteNavigationPolicy = 'blocked' | 'allowed';

export function decideActionBoundary(params: {
  /** 그 봇이 선언한 호스트들. 없으면 «선언되지 않은» 것이다. */
  hosts?: readonly string[];
  /** 이 조작이 여는 주소. */
  url: string;
  /** 누르려는 링크가 «가리키는» 곳. 이동이 아니면 null. */
  href: string | null;
  /**
   * 이 클릭이 «무엇을 일으키나». ⛔ 안 주면 «이동으로 가정하지 않는다» —
   * 모르면 `offsite` 를 열지 않는다(「모른다」를 「괜찮다」로 읽지 않는 이 저장소의 규율).
   */
  kind?: 'navigation' | 'submit' | 'other';
  /** 목적지를 미리 못 적는 봇이 «명시»한 값. 기본은 `blocked`(지금까지와 같다). */
  offsiteNavigation?: OffsiteNavigationPolicy;
}): BoundaryDecision {
  const rules = (params.hosts ?? []).filter((h) => typeof h === 'string' && h.trim() !== '');
  if (rules.length === 0) {
    return {
      verdict: 'undeclared',
      allowed: true,
      detail: '경계가 «선언되지 않았다» — 막지 않지만 이 조작은 «어디로든» 갈 수 있다',
    };
  }

  const check = (url: string, what: string): BoundaryDecision | null => {
    const host = hostOf(url);
    // ⛔ 「주소를 못 읽었다」를 「경계 안」으로 접지 않는다 — 모르면 막는다.
    if (host === null) return { verdict: 'outside', allowed: false, detail: `${what} 주소를 «못 읽었다» — 모르는 곳은 «안 누른다»: ${url.slice(0, 60)}` };
    if (rules.some((r) => hostMatches(host, r))) return null;
    return {
      verdict: 'outside',
      allowed: false,
      detail: `${what}(${host})이 이 봇의 «경계 밖»이다 — 선언된 곳: ${rules.join(' · ')}`,
    };
  };

  // ⛔ 여는 주소를 «먼저» 본다 — 경계 밖 페이지에서는 아예 손을 안 쓴다.
  const pageOutside = check(params.url, '여는 주소');
  if (pageOutside) return pageOutside;

  if (params.href !== null) {
    // ⭐ ***이것이 이 모듈의 요지다*** — 누르기 «전»에 「어디로 가는지」를 보고 막는다.
    const hrefOutside = check(params.href, '링크가 가리키는 곳');
    if (hrefOutside) {
      // ⛔ 비-HTTP(S) 는 호스트 경계를 «넘은» 이동이 아니다 — 스킴을 못 읽으면
      //    offsiteNavigation=allowed ⊕ kind=navigation 예외로 되돌리지 않는다.
      if (hostOf(params.href) === null) return hrefOutside;
      // 🆕 그 봇이 「나는 바깥을 읽는다」를 «명시»했고, 이것이 «이동»이면 넘긴다 — 대신 «센다».
      if (params.offsiteNavigation === 'allowed' && params.kind === 'navigation') {
        return {
          verdict: 'offsite-navigation',
          allowed: true,
          detail: `${hrefOutside.detail} ⇒ 그러나 이 봇은 «바깥 이동»을 명시로 열었다(offsiteNavigation=allowed) — ***넘은 것을 센다***`,
        };
      }
      return hrefOutside;
    }
  }

  return {
    verdict: 'inside',
    allowed: true,
    detail: params.href === null
      ? `여는 주소가 경계 안이다(링크 목적지는 «없다» — 이동이 아니다)`
      : '여는 주소와 링크 목적지가 «둘 다» 경계 안이다',
  };
}
