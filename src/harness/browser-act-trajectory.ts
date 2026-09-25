/**
 * 🎬 **녹화 — ⛔ 「새 기록기를 짓는 일」이 아니라 「이미 남는 관측을 «궤적»으로 되읽는 일」이다.**
 *
 * 📌 RFC §4.2 가 그 결정을 못 박았다(2026-08-27):
 *    > 관측이 이미 싣는 것   harness.browser-action / executed ⇒ target · coordinates{x,y} · runId
 *    > 심이 이미 먹는 것     ComputerUseTrajectoryStep = { target, coordinates{x,y} }
 *    > ⛔ 그러므로 `C2` 는 playwright 를 «안 더한다».
 *
 * 🔑 그래서 이 파일은 ***한 방향의 번역기***다 — 관측 JSONL → 궤적.
 *    ⛔ 새 기록 형식을 만들지 않는다. 새 의존을 더하지 않는다.
 */

import { extractBrowserActStep } from './browser-act-step.js';

export interface TrajectoryStep {
  /** 언제 — ⛔ 재생 «순서»가 이것으로 정해진다. */
  ts: string;
  url: string;
  target: string;
  coordinates: { x: number; y: number } | null;
  personaId: string | null;
  /** 그때 화면이 «왔나» — 재생 결과를 대조할 기준선. */
  captureOutcome: string | null;
  /** ⭐ 「실제로 간 곳」. ⛔ undefined = 그 값을 «안 싣던» 옛 행(재현이 좌표로 되돌아간다). */
  landedUrl?: string | null;
  /** 그때 저장된 그림(있으면). ⛔ 첨부 저장소는 /tmp 라 «사라졌을 수» 있다. */
  shotSavedTo: string | null;
  /** ⛔ 성공한 조작만 궤적이 아니다 — 실패도 «그 순간 무엇을 하려 했나»의 기록이다. */
  ok: boolean;
  failureReason: string | null;
}

export interface TrajectoryReadResult {
  steps: TrajectoryStep[];
  /** ⛔ 「0걸음」을 읽기 «전»에 봐야 하는 것들. */
  diagnostics: {
    /** 조회가 상한에 닿았나 — 닿았으면 이 궤적은 «부분»이다. */
    truncated: boolean;
    /** 읽은 행 수(궤적으로 «안 들어간» 것 포함). */
    rowsSeen: number;
    /** 궤적에서 «뺀» 행과 이유. */
    skipped: Record<string, number>;
  };
}

/**
 * `logs --category harness.browser-act --json` 산출(JSONL)을 궤적으로 되읽는다.
 *
 * ⛔ `data` 는 «문자열»이다 — 두 번 파싱한다.
 * ⛔ `_meta` 를 «버리기 전에» limitReached 를 읽는다 — 안 그러면 잘린 궤적을 «전부»로 읽는다.
 * ⛔ 「없다」와 「못 봤다」를 같은 값으로 만들지 않는다 — 뺀 행을 이유별로 «센다».
 */
/**
 * 🔬⭐⭐⭐ **누구의 걸음을 볼 것인가** (2026-08-30 · 37차 · RFC §23b-4 의 `P3`)
 *
 * 🚨 계기 — ***궤적이 「그 봇이 한 것」이 아니었다***:
 * ```
 * 📏 실측 2026-08-30   newsbot 궤적 104걸음  =  탐침 87(84%)  +  봇의 진짜 조작 17
 *                      ⇒ 「재현할 수 있다」가 실은 ***「탐침을 재현할 수 있다」***였다
 * ```
 * ⛔ **기본은 `bot`** — 이 궤적의 뜻이 「그 봇이 무엇을 했나」이기 때문이다.
 *    ⚠️ 다만 ***「모르면 봇의 것」***이다(옛 행엔 귀속 칸이 «없다» · 빼면 과거가 통째로 사라진다).
 * ⭐ `probe` 는 카나리아가 «자기 탐침»을 되찾을 때 쓴다(`recorded` 검사).
 */
export type TrajectoryActor = 'bot' | 'probe' | 'all';

/** 이 걸음이 그 「배우」에 해당하나. ⛔ 「모른다」는 «봇 쪽»으로 둔다(옛 행 보호). */
export function stepMatchesActor(attributionKind: string | null | undefined, actor: TrajectoryActor): boolean {
  if (actor === 'all') return true;
  if (actor === 'probe') return attributionKind === 'probe';
  // actor === 'bot' — ⛔ 「탐침이라고 «적혀 있는» 것」만 뺀다. 나머지(모르는 것 포함)는 봇의 것으로 둔다.
  return attributionKind !== 'probe';
}

export function readTrajectory(jsonl: string, filter: { personaId?: string; actor?: TrajectoryActor } = {}): TrajectoryReadResult {
  const actor: TrajectoryActor = filter.actor ?? 'bot';
  const skipped: Record<string, number> = {};
  const bump = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let truncated = false;
  let rowsSeen = 0;
  const steps: TrajectoryStep[] = [];

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let row: unknown;
    try { row = JSON.parse(trimmed); } catch { bump('json-parse-failed'); continue; }
    if (typeof row !== 'object' || row === null) { bump('not-an-object'); continue; }
    const record = row as Record<string, unknown>;

    // ⛔ `_meta` 를 «버리기 전에» limitReached 를 읽는다 — 안 그러면 잘린 궤적을 «전부»로 읽는다.
    const meta = record._meta as Record<string, unknown> | undefined;
    if (meta) {
      if (meta.type === 'log-query-limit' && meta.limitReached === true) truncated = true;
      continue;
    }
    rowsSeen += 1;

    // ⭐ «파싱»은 공유한다 — 이 저장소에 같은 변환이 «둘» 있었다(browser-act-step.ts 머리말).
    const extracted = extractBrowserActStep(record);
    if (!extracted.ok) {
      bump(extracted.reason === 'missing-target' ? 'missing-url-or-target' : `data-${extracted.reason}`);
      continue;
    }
    const step = extracted.step;

    // ⛔ 이 축의 «정책»: 실패한 조작도 «남긴다» — 거부도 「무엇을 하려 했나」의 기록이다.
    //    (심에 먹이는 축은 좌표 없는 걸음을 «버린다» — 정책이 다르다.)
    if (filter.personaId !== undefined && step.personaId !== filter.personaId) { bump('other-persona'); continue; }
    // 🔬 ⛔ 「덜 본다」는 조용하면 안 된다 — 뺀 수를 «이름을 대고» 센다(이 파일의 규율 그대로).
    if (!stepMatchesActor(step.attributionKind, actor)) {
      bump(actor === 'probe' ? 'not-a-probe' : 'canary-probe');
      continue;
    }
    if (step.url === '') { bump('missing-url-or-target'); continue; }

    steps.push({
      ts: step.ts,
      url: step.url,
      target: step.target,
      coordinates: step.coordinates,
      personaId: step.personaId,
      captureOutcome: step.captureOutcome,
      ...(step.landedUrl === undefined ? {} : { landedUrl: step.landedUrl }),
      shotSavedTo: step.shotSavedTo,
      ok: step.ok,
      failureReason: step.failureReason,
    });
  }

  // ⛔ 관측은 «최신순»으로 온다 — 재생은 «일어난 순서»여야 한다.
  steps.sort((a, b) => a.ts.localeCompare(b.ts));
  return { steps, diagnostics: { truncated, rowsSeen, skipped } };
}

/** 궤적을 사람이 읽는 한 줄로. ⛔ 「걸음 N개」만 내지 않는다 — «무엇을 못 봤나»를 같이 낸다. */
export function describeTrajectory(result: TrajectoryReadResult): string {
  const { steps, diagnostics } = result;
  const skippedTotal = Object.values(diagnostics.skipped).reduce((a, b) => a + b, 0);
  const parts = [`걸음 ${steps.length}개`, `행 ${diagnostics.rowsSeen}개`];
  if (skippedTotal > 0) {
    parts.push(`뺀 행 ${skippedTotal}개(${Object.entries(diagnostics.skipped).map(([k, v]) => `${k}=${v}`).join(' · ')})`);
  }
  if (diagnostics.truncated) parts.push('⚠️ 조회가 상한에 닿았다 — 이 궤적은 «부분»이다');
  return parts.join(' · ');
}
