/**
 * mirror-runtime.ts — ⛔⭐⭐⭐ ***「문서 자기완결」과 「실행 자기완결」은 «다른 값»이다.***
 *
 * 🩸 왜 생겼나(2026-09-11 🅕): `render-mirror` 가 starbucks 를 **✅ self-contained**(원격 참조 0)라
 *    판정했는데, 그 미러를 `http://` 로 «실제로 열어» 보니 원격 요청이 나갔다:
 *      `//image.istarbucks.co.kr/img/event/2022/footer_award_2211_0*.jpg` ×7
 *      `/common/js/esabsbuxkr.js?async`
 *    ⛔ 그런데 저장된 문서에서 그 둘은 ***제대로 `_r/…` 로 바뀌어 있었다***.
 *    🔑 ***JS 가 런타임에 «또» 만들어 부르는 것***이고, 문자열 치환으로는 ***원리상 못 막는다.***
 *
 * ⇒ 그래서 판정을 «둘»로 가른다:
 *    ⓐ **문서 자기완결** — 저장된 HTML 에 원격 참조가 없다(`render-mirror` 가 잰다)
 *    ⓑ **실행 자기완결** — 열었을 때 원격으로 «나가는 요청»이 없다(이 자가 잰다)
 * ⛔ ⓐ 만 보고 「클론이 됐다」고 하면, ***좋은 판정이 깨진 화면을 덮는다***
 *    (이 창이 내내 경계한 「좋아 보이게 하는」 방향 — `RESULT-F-…` ⓚⓚ).
 *
 * ⛔ 순수 — 프로세스·네트워크를 안 탄다. 실행은 `scripts/webclone/check-mirror-runtime.ts`.
 */

/** 요청 한 건의 «성질». ⛔ 모르면 `unknown` — 로컬로 몰지 않는다. */
export type RequestOrigin = 'local' | 'remote' | 'inline' | 'unknown';

/** `data:`·`blob:`·`about:` 처럼 «네트워크를 안 타는» 것들. */
export const INLINE_SCHEMES: readonly string[] = ['data:', 'blob:', 'about:', 'javascript:', 'filesystem:'];

/**
 * ⛔ 「로컬인가」는 ***미러를 서빙하는 출처와 «같은가»***로 본다.
 *    ⚠️ 호스트 이름이 아니라 «출처»다 — 포트가 다르면 다른 곳이다.
 */
export function classifyRequestOrigin(url: string, mirrorOrigin: string): RequestOrigin {
  const raw = url.trim();
  if (raw.length === 0) return 'unknown';
  for (const scheme of INLINE_SCHEMES) if (raw.toLowerCase().startsWith(scheme)) return 'inline';
  try {
    const u = new URL(raw);
    return u.origin === mirrorOrigin ? 'local' : 'remote';
  } catch {
    // 상대 경로는 문서 출처로 풀리므로 로컬이다. 단 «못 읽은» 것은 모른다고 둔다.
    return raw.startsWith('/') || /^[.\w]/.test(raw) ? 'local' : 'unknown';
  }
}

export interface RuntimeRequest {
  readonly url: string;
  /** CDP `Network.requestWillBeSent` 의 `type`. 없으면 null. */
  readonly resourceType: string | null;
  /** 실패했으면 그 문면. 성공/미상은 null. */
  readonly failure?: string | null;
}

export interface RuntimeTally {
  readonly total: number;
  readonly local: number;
  readonly remote: number;
  readonly inline: number;
  readonly unknown: number;
  /** 원격 호스트별 수 — 「누가 붙어 있나」를 이름으로 낸다. */
  readonly remoteByHost: ReadonlyArray<readonly [string, number]>;
  /** ⛔ 표본을 낸다 — 수만 내면 고칠 데를 못 찾는다. */
  readonly remoteSample: readonly string[];
  /**
   * ⛔⭐⭐ ***「미러가 줬어야 할 파일」이 실패한 수*** — ***이것만이 미러의 결손이다.***
   *
   * 🩸 첫 판은 «로컬 실패»를 통째로 「미러의 결손」이라 불렀다. 그러자 apple 에서
   *    ***Adobe 분석 비콘***(`http://127.0.0.1/b/ss/applestoreww/…`)이 결손으로 세어졌고,
   *    실행마다 **5 ↔ 2** 로 흔들렸다. ⛔ 그것은 ***JS 가 지어낸 경로***이지 미러가 줄 것이 아니다.
   * 🔑 오늘 내내 고친 ***「분모 오염」이 «내가 방금 만든 자»에 그대로 있었다.***
   */
  readonly failedMirrorFile: number;
  /** JS 가 «지어낸» 경로가 우리 출처로 풀려 실패한 수. ⛔ 결손이 «아니다» — 세기만 한다. */
  readonly failedInventedPath: number;
  readonly failedRemote: number;
  /**
   * ⛔⭐ ***같은 «호스트»인데 포트만 다른 요청*** — 「바깥 인터넷」이 «아니다».
   *
   * 🩸 apple 실측: `http://127.0.0.1/b/ss/applestoreww/…`(포트 80)이 «원격»으로 세어졌다.
   *    그것은 Adobe 분석 비콘이 ***호스트 없이 만들어져*** 우리 호스트로 풀린 것이고,
   *    ***원본 사이트의 서버를 부른 것이 «아니다»***.
   * 🔑 ⇒ 「원격을 부른다」가 물어야 할 것은 ***「바깥으로 나가나」***다.
   *    같은 호스트의 다른 포트는 ***미러를 로컬에 띄운 «부작용»***이지 의존이 아니다.
   * ⛔ `classifyRequestOrigin` 은 «출처»로 판정한다(글자 그대로 옳다) — 여기서 «따로» 센다.
   */
  readonly sameHostOtherPort: number;
}

/**
 * ⛔ 「미러가 줬어야 할 것」인가 — 경로로 가른다.
 *    미러가 내놓는 것은 ***문서 자신*** 과 ***`_r/` 아래***뿐이다. 그 밖은 JS 가 지어낸 것이다.
 */
export function isMirrorFilePath(url: string, mirrorOrigin: string): boolean {
  try {
    const u = new URL(url, mirrorOrigin);
    if (u.origin !== mirrorOrigin) return false;
    const p = u.pathname;
    return p === '/' || p === '/index.html' || p.startsWith('/_r/');
  } catch { return false; }
}

export function tallyRuntime(requests: readonly RuntimeRequest[], mirrorOrigin: string): RuntimeTally {
  let local = 0, remote = 0, inline = 0, unknown = 0, failedMirrorFile = 0, failedInventedPath = 0, failedRemote = 0;
  let sameHostOtherPort = 0;
  let mirrorHost = '';
  try { mirrorHost = new URL(mirrorOrigin).hostname; } catch { /* 못 읽으면 빈 값 */ }
  const hosts = new Map<string, number>();
  const sample: string[] = [];
  for (const r of requests) {
    const kind = classifyRequestOrigin(r.url, mirrorOrigin);
    const failed = typeof r.failure === 'string' && r.failure.length > 0;
    if (kind === 'local') {
      local += 1;
      // ⛔ 「미러가 줬어야 할 것」만 결손으로 센다 — JS 가 지어낸 경로는 «따로» 센다.
      if (failed) { if (isMirrorFilePath(r.url, mirrorOrigin)) failedMirrorFile += 1; else failedInventedPath += 1; }
      continue;
    }
    if (kind === 'inline') { inline += 1; continue; }
    if (kind === 'unknown') { unknown += 1; continue; }
    let host = '?';
    let hostname = '';
    try { const u = new URL(r.url); host = u.host; hostname = u.hostname; } catch { /* 못 읽으면 물음표 */ }
    // ⛔ 같은 «호스트»의 다른 포트는 「바깥으로 나간 것」이 «아니다» — 갈라 센다.
    if (mirrorHost !== '' && hostname === mirrorHost) {
      sameHostOtherPort += 1;
      if (failed) failedInventedPath += 1;
      continue;
    }
    remote += 1;
    if (failed) failedRemote += 1;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    if (sample.length < 6) sample.push(`${r.resourceType ?? '?'} ${r.url.slice(0, 80)}`);
  }
  const remoteByHost = [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    total: requests.length, local, remote, inline, unknown,
    remoteByHost, remoteSample: sample, failedMirrorFile, failedInventedPath, failedRemote, sameHostOtherPort,
  };
}

export type RuntimeVerdictKind = 'runtime-self-contained' | 'runtime-calls-remote' | 'unmeasured';

export interface RuntimeVerdict {
  readonly kind: RuntimeVerdictKind;
  readonly why: string;
}

/**
 * ⛔⭐ 「열어 보지도 못했다」를 「원격을 안 부른다」로 «접지 않는다».
 *    요청이 «하나도» 없으면 그것은 ***성공이 아니라 「못 쟀음」***이다.
 */
export function judgeRuntime(tally: RuntimeTally): RuntimeVerdict {
  if (tally.total === 0) {
    return { kind: 'unmeasured', why: '요청을 «하나도» 못 봤다 — ⛔ 「원격을 안 부른다」가 아니라 「못 쟀다」다(문서를 못 열었을 수 있다)' };
  }
  // ⛔ 「미러가 줬어야 할 것」이 실패한 것만 결손으로 «말한다».
  const localTail = tally.failedMirrorFile > 0
    ? ` 🚨 그리고 ***미러 파일 ${tally.failedMirrorFile}건이 «실패»했다*** — 그것은 미러의 «결손»이다`
    : '';
  const portTail = tally.sameHostOtherPort > 0
    ? ` (⊕ 같은 호스트의 «다른 포트» ${tally.sameHostOtherPort}건 — 미러를 로컬에 띄운 «부작용»이지 «바깥»이 아니다)`
    : '';
  const inventedTail = tally.failedInventedPath > 0
    ? ` (⊕ JS 가 «지어낸» 경로 ${tally.failedInventedPath}건도 실패했지만 그것은 «결손이 아니다» — 분석 비콘 따위다)`
    : '';
  if (tally.remote === 0) {
    return { kind: 'runtime-self-contained', why: `요청 ${tally.total}건이 전부 로컬·인라인이다 — 실행도 자기완결이다${localTail}${inventedTail}${portTail}` };
  }
  const top = tally.remoteByHost.slice(0, 3).map(([h, n]) => `${h} ${n}`).join(' · ');
  return {
    kind: 'runtime-calls-remote',
    why: `원격 요청 ${tally.remote}건(${top}) — ⛔ 문서가 자기완결이어도 ***실행이 원격을 부른다***`
      + `(JS 가 만든 URL 은 문자열 치환으로 «원리상» 못 막는다)${localTail}${inventedTail}${portTail}`,
  };
}

/** ⛔ 이 자가 «못 담는» 것을 값으로 낸다. */
export const MIRROR_RUNTIME_BLIND_SPOTS: readonly string[] = [
  'after-interaction: 누른 «뒤»에 나가는 요청은 안 보인다 — 이 자는 첫 렌더 ⊕ 스크롤까지만 본다',
  'service-worker: 워커가 캐시에서 주면 요청이 «안 뜬다»',
  'timer-delayed: 한참 뒤 타이머로 나가는 요청은 예산 밖이다',
  'beacon-on-unload: 떠날 때 보내는 신호는 이 자가 닫은 뒤다',
];
