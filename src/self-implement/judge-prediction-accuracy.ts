// 🎯 판사의 «자기 예측 적중»을 이력에서 되읽는다.
//
// ⛔⭐⭐ **왜 필요한가**(🅣 관측 2026-08-20 · 대표 이 이 축을 🅢 에 맡겼다):
//   한 런에서 판사가 `EXTEND` 를 «네 번» 냈고 사유가 전부 *"한 라운드 안에 해결 가능하다"* 였다.
//   네 번 다 «안 끝났고» 하드캡에 닿아 사람이 개입했다.
//   ⇒ 🔑 ***판사는 자기가 뭐라 했는지는 보는데, 그것이 «틀렸다»는 사실은 못 본다.***
//     프롬프트에 실리는 이력이 「라운드·판정·사유」 셋뿐이라 «결과»가 안 붙는다.
//
// ⛔ **새 저장소를 만들지 않는다** — 필요한 것은 «이미 있는» 이력을 되읽는 함수 하나다.
// ⛔ **막지 않는다** — 이 모듈은 판정을 «바꾸지 않는다». 판사에게 «사실 한 줄»을 줄 뿐이다.
//   ***낙관을 금지하는 것과 낙관이 틀렸다는 사실을 보여 주는 것은 다른 축이다.***

/** 판사가 라운드마다 낸 것. ⛔ orchestrator 의 supervisorDecisionHistory 와 «같은 모양»이다. */
export interface JudgeRoundDecision {
  readonly round: number;
  readonly verdict: string;
  readonly reason: string;
}

export interface JudgePredictionAccuracy {
  /** 「한 라운드 더면 끝난다」고 말한 횟수(=EXTEND). */
  readonly predicted: number;
  /** 그 예측 «다음» 라운드에서 실제로 끝난 횟수. */
  readonly fulfilled: number;
  /** 예측했는데 그 다음 라운드에도 «또» 판정이 필요했던 횟수. */
  readonly missed: number;
  /** ⛔ 「아직 결과를 모른다」 — 마지막 EXTEND 는 다음 라운드가 «아직 없다».
   *  ⇒ 이 칸이 있어서 「빗나갔다」와 「모른다」가 안 접힌다. */
  readonly pending: number;
}

const FULFILLED_VERDICTS = new Set(['SUFFICIENT']);

/**
 * 이력에서 「EXTEND 예측이 맞았나」를 센다.
 *
 * ⭐ 판정 규칙 — `EXTEND` 는 「한 라운드 더 주면 끝난다」는 «예측»이다.
 *   ⇒ 그 «다음» 항목이 SUFFICIENT 면 맞았고, 또 EXTEND 면 빗나갔다.
 * ⛔ 다음 항목이 «없으면» 빗나간 것이 아니라 ***아직 모른다***(pending).
 * ⛔ 다음 항목이 UNCONVERGEABLE/CONTRACT-CONFLICT 면 「끝났다」가 아니다 — missed 로 센다
 *   (그 예측은 「해결된다」였는데 해결되지 않았다).
 */
export function judgePredictionAccuracy(
  history: readonly JudgeRoundDecision[],
): JudgePredictionAccuracy {
  let predicted = 0;
  let fulfilled = 0;
  let missed = 0;
  let pending = 0;
  for (let i = 0; i < history.length; i += 1) {
    if (history[i]!.verdict !== 'EXTEND') continue;
    predicted += 1;
    const next = history[i + 1];
    if (next === undefined) { pending += 1; continue; }
    if (FULFILLED_VERDICTS.has(next.verdict)) fulfilled += 1;
    else missed += 1;
  }
  return { predicted, fulfilled, missed, pending };
}

/**
 * 판사 프롬프트에 붙일 «사실 한 줄». ⛔ 지시가 아니라 «관측»이다.
 *
 * ⛔ 예측이 하나도 없으면 «아무 줄도 안 낸다** — 「0/0」을 보여 주면 판사가 그것을 신호로 읽는다.
 * ⛔ pending 을 «따로» 적는다 — 「아직 모른다」를 「빗나갔다」로 읽히게 하지 않는다.
 */
export function renderJudgePredictionAccuracy(
  accuracy: JudgePredictionAccuracy,
): string | undefined {
  const resolved = accuracy.fulfilled + accuracy.missed;
  if (resolved === 0) return undefined;
  const parts = [
    `이 런에서 당신의 지난 EXTEND 예측: ${resolved}건 중 ${accuracy.fulfilled}건 적중 · ${accuracy.missed}건 빗나감`,
  ];
  if (accuracy.pending > 0) parts.push(`(결과 미확정 ${accuracy.pending}건은 위 수에 넣지 않았다)`);
  return `${parts.join(' ')}\n⚠️ 이것은 사실 관측이지 판정 지시가 아니다 — 규칙은 그대로 적용한다.`;
}

/** 🅕 발견 ①·② (2026-08-20) — **판사가 «자기가 쓰는 수»와 «추세»를 보게 한다**.
 *
 *  📏 실물 둘:
 *  ⓐ 판사가 EXTEND 사유에 *"이전 지적의 «반복이 아니라»…"* 라 쓰면서
 *     ***같은 레코드의 `citedReviewSymbolRepeatCount` 가 1, 다음 라운드에 2*** 였다.
 *     ⇒ 🔑 「신호가 없다」가 아니라 ***「신호가 손에 있는데 «안 본다»」***.
 *  ⓑ EXTEND 사유 6개가 «전부» 「새롭고 좁다 ⇒ 한 라운드면 된다」 구조였다.
 *     ⛔⭐ 그런데 ***「매 라운드 «새» 결함이 나온다」는 수렴이 아니라 «비수렴»의 서명***이다.
 *     리뷰가 바닥 없이 새 것을 찾으면 그 기준은 «영원히 참»이다.
 *     📏 must-fix 가 5→3→2→3 · 4→3→4 로 «한 번도 0 에 안 닿았는데» 매번 「한 라운드면 된다」였다.
 *
 *  ⛔ **임계를 박지 않는다**(🅕 제안 그대로) — 두 값을 «보여 주고» 판사가 쓰게 한다.
 *  ⛔ 이것도 「막기」가 아니라 «사실 보여 주기»다. 판정 규칙은 그대로다. */
export function renderJudgeOwnSignals(input: {
  /** 이번 라운드 봉투에 실린 심볼 반복 수. */
  readonly citedReviewSymbolRepeatCount?: number | null;
  /** 라운드 순서대로의 must-fix 수(가장 오래된 것부터). */
  readonly mustFixTrend?: readonly number[];
}): string | undefined {
  const lines: string[] = [];

  if (typeof input.citedReviewSymbolRepeatCount === 'number') {
    // ⛔ 0 도 «싣는다» — 「반복 없음」이 사실이면 그것도 판사가 알아야 한다.
    lines.push(`이번 라운드 지적 중 «이전 라운드와 심볼이 겹치는» 것: ${input.citedReviewSymbolRepeatCount}건`);
  }

  const trend = input.mustFixTrend ?? [];
  if (trend.length >= 2) {
    lines.push(`must-fix 추세(라운드 순): ${trend.join(' → ')}`);
    // ⛔⭐ 「처음보다 줄었나」로 보면 «틀린다** — 5→3→2→3 은 처음보다 줄었지만 «되올랐고 0 에 못 닿았다».
    //   🔑 판사가 매번 「한 라운드면 된다」라 쓴 실물이 정확히 그 모양이다.
    //   ⇒ 두 사실을 «따로» 적는다: ⓐ 마지막이 직전보다 «안 줄었나» ⓑ 한 번도 0 에 «안 닿았나».
    const last = trend[trend.length - 1]!;
    const prev = trend[trend.length - 2]!;
    if (last >= prev) lines.push(`⚠️ 마지막 라운드가 직전보다 «안 줄었다»(${prev} → ${last}).`);
    if (!trend.includes(0)) {
      lines.push('⚠️ 이 런은 must-fix 가 «한 번도 0 에 안 닿았다» — 「한 라운드면 된다」를 쓰기 전에 그 근거를 다시 보라.');
    }
  }

  if (lines.length === 0) return undefined;
  return `${lines.join('\n')}\n⚠️ 이것은 사실 관측이지 판정 지시가 아니다 — 규칙은 그대로 적용한다.`;
}

/** 라운드별 must-fix 수를 rework 이력 문자열에서 «읽는다».
 *
 *  ⛔ 새 저장소를 만들지 않는다 — 이력이 이미 라운드마다 지적 목록을 담고 있다.
 *  ⛔ 못 읽으면 «빈 배열»이다 — 0 으로 채우지 않는다(「지적 0건」과 「못 읽었다」는 다른 값). */
export function mustFixTrendFromHistory(history: readonly string[]): number[] {
  return history.map((entry) => (entry.match(/^- /gm) ?? []).length).filter((n) => n > 0);
}
