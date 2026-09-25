/**
 * 🧹 **클릭이 «연» 새 탭을 회수한다.**
 *
 * ⛔ 실측 2026-08-28(T44): `browser-act` 를 80발 돌린 뒤 카나리아가 `tabs=실패` 를 냈다.
 *    남은 탭은 `copilot.microsoft.com` — ***bing 클릭이 `target=_blank` 로 «새 탭»을 열었다***.
 *    🔑 `performBrowserAction` 의 `finally` 는 ***«붙어 있던» 페이지***를 닫는다.
 *       새 탭은 «다른 타깃»이라 안 닫힌다.
 *
 * 🚨 그리고 이것은 ***방치하면 커진다*** — 대표 이 2026-08-28 에 「쓴다」를 승인했고,
 *    루틴이 매일 클릭한다. 카나리아 자신이 그 위험을 이미 적어 뒀다:
 *    「여럿이면 폴러가 배경 탭을 잡아 «캡처가 매달린다»」
 *
 * ⛔ **모르는 탭을 지우지 않는다** — 조작 «전»에 없던 것만 닫는다.
 *    사람이 열어 둔 탭·봇이 쓰던 탭을 «회수 대상으로 삼지 않는다».
 */

export type CdpTarget = { readonly id?: unknown; readonly type?: unknown };

/**
 * `/json/list` 산출에서 «페이지» 타깃의 id 만 뽑는다.
 * ⛔ `iframe`·`service_worker`·`browser_ui` 는 탭이 아니다 — 세지도 닫지도 않는다.
 */
export function pageTargetIds(raw: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const entry of parsed as CdpTarget[]) {
    if (entry === null || typeof entry !== 'object') continue;
    if (entry.type !== 'page') continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    out.push(entry.id);
  }
  return out;
}

export type TabReclaimPlan = {
  /** 닫을 탭 — 조작 «전»에 없던 것들. */
  readonly close: readonly string[];
  /** 왜 그렇게 정했나 — ⛔ 「0개」일 때도 «무엇을 봤나»를 낸다. */
  readonly detail: string;
};

/**
 * 조작 전후의 페이지 목록을 받아 «회수할 것»을 정한다.
 *
 * ⛔ 마지막 하나는 «남긴다» — page 가 0이면 브라우저가 죽는다.
 * ⛔ 전후 중 하나라도 «못 읽었으면»(빈 배열) 아무것도 안 닫는다 — 「없다」와 「못 봤다」는 다른 값이다.
 */
export function planTabReclaim(params: {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly beforeReadable: boolean;
  readonly afterReadable: boolean;
}): TabReclaimPlan {
  const { before, after, beforeReadable, afterReadable } = params;
  if (!beforeReadable || !afterReadable) {
    return { close: [], detail: '탭 목록을 «못 읽었다» — 「새 탭이 없다」가 아니라 판정 불가라 아무것도 안 닫는다' };
  }
  const known = new Set(before);
  const opened = after.filter((id) => !known.has(id));
  if (opened.length === 0) {
    return { close: [], detail: `클릭이 «새 탭을 안 열었다»(전 ${before.length} · 후 ${after.length})` };
  }
  // ⛔ 브라우저에 페이지가 «하나도» 안 남게 하지 않는다.
  const keepAtLeastOne = after.length - opened.length === 0 ? opened.slice(0, -1) : opened;
  return {
    close: keepAtLeastOne,
    detail: `클릭이 «새 탭» ${opened.length}개를 열었다 — ${keepAtLeastOne.length}개 회수(전 ${before.length} · 후 ${after.length})`,
  };
}
