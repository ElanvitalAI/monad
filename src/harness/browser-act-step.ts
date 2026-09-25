/**
 * 🧩 **관측 «한 행» → 궤적 «한 걸음». — ⛔ 이 저장소에 이 변환이 «둘» 있었다.**
 *
 * 📏 2026-08-28 실측: `browser-trajectory.ts`(runId 축 · 심에 먹인다)와
 *    `browser-act-trajectory.ts`(persona 축 · 재현에 먹인다)가 ***같은 행을 각자 풀고 있었다***.
 *    🪞 뒤엣것을 내가 지었고, 앞엣것이 «이미 있다는 것을 나중에» 알았다.
 *
 * 🔑 그런데 둘은 «버리는 기준»이 다르다:
 *    ⓐ 심에 먹이려면 ***좌표가 «있어야»*** 한다(없으면 재생 못 한다)
 *    ⓑ 재현·기록에는 ***실패도 남겨야*** 한다(거부도 「무엇을 하려 했나」의 기록이다)
 * ⇒ 📌 그러므로 «파서를 하나»로 두고 ***버리는 일은 «부르는 쪽»이 한다.***
 */

export interface BrowserActStep {
  ts: string;
  url: string;
  target: string;
  /** ⛔ 실패한 조작은 좌표가 «없다» — null 과 「0,0」을 같은 값으로 만들지 않는다. */
  coordinates: { x: number; y: number } | null;
  personaId: string | null;
  runId: string | null;
  captureOutcome: string | null;
  shotSavedTo: string | null;
  /**
   * ⚠️⭐ **왜 «선택» 필드인가**: 이 타입은 export 라, 필수 필드를 더하면 tsc 게이트가
   *    ***저장소 «전체» 검사로 승격***한다(📏 실측 2026-08-28: 그러자 이 변경과 무관한
   *    `apps/pwa` 선행 오류가 드러났다). [T] 131차가 같은 날 같은 자리를 밟고 같은 처방을 냈다.
   *    ⛔ 게이트를 「거짓 양성」으로 읽고 우회하지 마라 — 그 승격은 «정당하다».
   *
   * ⭐ 「가려던 곳」 — 누르기 «전»에 읽은 `<a href>` 의 절대 URL.
   * ⛔ null 은 「이동이 아니었다」일 수도, 「그 판이 이 값을 안 싣던 «옛» 행이다」일 수도 있다.
   */
  clickedHref?: string | null;
  /** ⭐ 「실제로 간 곳」 — 이동 «뒤»의 `location.href`. 위와 «다를 수 있고», 그 차이가 관측이다. */
  landedUrl?: string | null;
  /** 사람이 읽는 짧은 글. 선택자만으론 「무엇을 눌렀나」를 못 읽는다. */
  clickedText?: string | null;
  /**
   * 🛬 「가려던 곳 ↔ 간 곳」을 견준 «부류»(exact · same-host · www-only · cross-host · did-not-move …).
   * ⛔⭐ 회귀 판정은 ***이 «부류»로만*** 한다 — 착지 «호스트»·좌표는 내용이 바뀌면 흔들린다
   *    (📏 2026-08-28 실측: HN 기사 링크는 첫 화면이 바뀌면 호스트가 달라지는데 부류는 exact 그대로다).
   */
  landingVerdict?: string | null;
  /**
   * ⚠️ **주석 정정(2026-08-28 · `#13681`)**: 옛 문면은 *"성공 행에는 `ok` 칸이 «없다»"* 였다 — 이제 «있다».
   *    ⛔ 그래도 `undefined ⇒ 성공` 해석은 «남긴다» — 그 착지 «전»에 쌓인 옛 행이 그대로 조회된다.
   */
  ok: boolean;
  failureReason: string | null;
  /**
   * 🔬⭐⭐ **누가 이 조작을 했나**(`run` · `bot` · **`probe`** · `entry-point`) — 2026-08-30 · 37차.
   *
   * ⛔⭐ **`undefined` 를 「봇이 아니다」로 읽지 «마라»** — 이 칸이 «생기기 전»의 행이 그렇다.
   *    📏 실측: newsbot 궤적 104걸음이 전부 그 옛 행이다. 그것을 빼면 궤적이 «통째로» 빈다.
   *    ⇒ 🔑 부르는 쪽은 ***「모르면 봇의 것으로 둔다」***(과거를 지어내지 않는다).
   * ⚠️ 그래서 이 칸의 «값»은 앞으로 쌓이는 것에서만 참이다 — 그 사실을 세는 쪽이 말해야 한다.
   */
  attributionKind?: string | null;
  /**
   * ⛔ 「좌표 칸이 «없었다»」와 「있었는데 «못 읽었다»」는 다른 값이다.
   *    앞엣것은 「그 조작에 좌표가 없다」(실패했다)이고, 뒤엣것은 «자료가 깨진» 것이다.
   *    ⇒ 부르는 쪽이 그 둘을 다르게 세고 싶어 한다(browser-trajectory 의 discarded 가 그렇다).
   */
  coordinatesPresent: boolean;
}

export type StepExtractionFailure = 'unrelated-event' | 'invalid-row' | 'missing-target';

export type StepExtraction =
  | { ok: true; step: BrowserActStep }
  | { ok: false; reason: StepExtractionFailure };

/** 이 축의 관측이 사는 자리. ⛔ 두 곳에 «다르게» 적혀 있으면 한쪽이 조용히 0건을 낸다. */
export const BROWSER_ACT_CATEGORY = 'harness.browser-action';
export const BROWSER_ACT_EVENT = 'executed';

/**
 * 관측 «한 행»을 걸음으로 푼다.
 *
 * ⛔ `data` 는 «문자열»이다 — 두 번 파싱한다(이 저장소가 2026-08-27 에 세 트랙이 밟은 자리).
 * ⛔ 「버릴지」는 «정하지 않는다» — 이유만 돌려주고 부르는 쪽이 정한다.
 */
export function extractBrowserActStep(row: {
  category?: unknown;
  event?: unknown;
  ts?: unknown;
  data?: unknown;
}): StepExtraction {
  // ⛔ 카테고리는 «둘 다» 받는다 — 관측은 'harness.browser-action' 으로 나가고
  //    조회는 'harness.browser-act' 로 하는 판이 있다(둘을 한 곳에 못 박아 둔다).
  const category = typeof row.category === 'string' ? row.category : '';
  const event = typeof row.event === 'string' ? row.event : '';
  const categoryOk = category === '' || category === BROWSER_ACT_CATEGORY || category === 'harness.browser-act';
  const eventOk = event === '' || event === BROWSER_ACT_EVENT;
  if (!categoryOk || !eventOk) return { ok: false, reason: 'unrelated-event' };

  let data = row.data as unknown;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return { ok: false, reason: 'invalid-row' }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid-row' };
  const d = data as Record<string, unknown>;

  const target = typeof d.target === 'string' ? d.target : '';
  if (target === '') return { ok: false, reason: 'missing-target' };

  const raw = d.coordinates as { x?: unknown; y?: unknown } | null | undefined;
  const coordinates = raw && typeof raw.x === 'number' && Number.isFinite(raw.x)
    && typeof raw.y === 'number' && Number.isFinite(raw.y)
    ? { x: raw.x, y: raw.y }
    : null;

  return {
    ok: true,
    step: {
      ts: typeof row.ts === 'string' ? row.ts : '',
      url: typeof d.url === 'string' ? d.url : '',
      target,
      coordinates,
      personaId: typeof d.personaId === 'string' ? d.personaId : null,
      runId: typeof d.runId === 'string' ? d.runId : null,
      captureOutcome: typeof d.captureOutcome === 'string' ? d.captureOutcome : null,
      shotSavedTo: typeof d.shotSavedTo === 'string' ? d.shotSavedTo : null,
      clickedHref: typeof d.clickedHref === 'string' && d.clickedHref !== '' ? d.clickedHref : null,
      landedUrl: typeof d.landedUrl === 'string' && d.landedUrl !== '' ? d.landedUrl : null,
      clickedText: typeof d.clickedText === 'string' && d.clickedText !== '' ? d.clickedText : null,
      landingVerdict: typeof d.landingVerdict === 'string' && d.landingVerdict !== '' ? d.landingVerdict : null,
      ok: d.ok !== false,
      failureReason: typeof d.failureReason === 'string' ? d.failureReason : null,
      attributionKind: (() => {
        const a = d.attribution;
        if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
        const k = (a as Record<string, unknown>).kind;
        return typeof k === 'string' && k !== '' ? k : null;
      })(),
      coordinatesPresent: Object.hasOwn(d, 'coordinates'),
    },
  };
}
