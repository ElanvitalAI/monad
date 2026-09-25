import { describe, expect, test } from 'bun:test';
import {
  judgePredictionAccuracy,
  mustFixTrendFromHistory,
  renderJudgeOwnSignals,
  renderJudgePredictionAccuracy,
  type JudgeRoundDecision,
} from './judge-prediction-accuracy.js';

const d = (round: number, verdict: string, reason = 'r'): JudgeRoundDecision => ({ round, verdict, reason });

describe('판사의 «자기 예측 적중» — 이력에서 되읽는다', () => {
  test('⭐⭐ 🅣 가 관측한 그 런 — EXTEND ×4 가 «전부 빗나갔다»로 센다', () => {
    // 📏 실물(2026-08-20 · goalId 2c2062db4b41d7b1): EXTEND 가 네 번, 끝난 적 없음.
    const history = [d(1, 'EXTEND'), d(2, 'EXTEND'), d(3, 'EXTEND'), d(4, 'EXTEND')];
    expect(judgePredictionAccuracy(history)).toEqual({
      predicted: 4, fulfilled: 0, missed: 3, pending: 1,
    });
    // 🔑 마지막 하나는 «아직 모른다» — 빗나간 것이 아니다.
  });

  test('⛔ 「아직 모른다」와 「빗나갔다」를 «접지 않는다»', () => {
    const one = judgePredictionAccuracy([d(1, 'EXTEND')]);
    expect(one).toEqual({ predicted: 1, fulfilled: 0, missed: 0, pending: 1 });
    expect(one.missed).toBe(0);
  });

  test('다음이 SUFFICIENT 면 «적중»이다', () => {
    expect(judgePredictionAccuracy([d(1, 'EXTEND'), d(2, 'SUFFICIENT')]))
      .toEqual({ predicted: 1, fulfilled: 1, missed: 0, pending: 0 });
  });

  test('⛔ 「해결됐다」가 아닌 «모든» 종결은 적중이 아니다 — 예측은 「해결된다」였다', () => {
    // ⛔ 리뷰 #10607 should-fix: 주석은 「터미널 판정은 missed」라 했는데 시험은 한 갈래만 물었다.
    //   ⇒ 「구현이 그렇게 동작한다」와 「그 동작이 고정돼 있다」는 다른 값이다. 전수로 못 박는다.
    for (const terminal of ['UNCONVERGEABLE', 'CONTRACT-CONFLICT']) {
      expect({ terminal, ...judgePredictionAccuracy([d(1, 'EXTEND'), d(2, terminal)]) })
        .toEqual({ terminal, predicted: 1, fulfilled: 0, missed: 1, pending: 0 });
    }
    // ⭐ 대조군 — «오직» SUFFICIENT 만 적중이다.
    expect(judgePredictionAccuracy([d(1, 'EXTEND'), d(2, 'SUFFICIENT')]).fulfilled).toBe(1);
    // ⛔ 모르는 판정이 새로 생겨도 «적중으로 새지 않는다»(allowlist 라 기본이 missed).
    expect(judgePredictionAccuracy([d(1, 'EXTEND'), d(2, 'SOME-FUTURE-VERDICT')]).missed).toBe(1);
  });

  test('EXTEND 가 «아닌» 판정은 예측으로 세지 않는다', () => {
    expect(judgePredictionAccuracy([d(1, 'SUFFICIENT'), d(2, 'CONTRACT-CONFLICT')]))
      .toEqual({ predicted: 0, fulfilled: 0, missed: 0, pending: 0 });
  });
});

describe('프롬프트 줄 — 사실이지 지시가 아니다', () => {
  test('⛔ 결과가 «하나도 확정 안 됐으면» 줄을 «안 낸다»', () => {
    // 0/0 을 보여 주면 판사가 그것을 신호로 읽는다.
    expect(renderJudgePredictionAccuracy({ predicted: 1, fulfilled: 0, missed: 0, pending: 1 })).toBeUndefined();
    expect(renderJudgePredictionAccuracy({ predicted: 0, fulfilled: 0, missed: 0, pending: 0 })).toBeUndefined();
  });

  test('⭐ 빗나간 이력이 있으면 «수»와 함께 낸다 ⊕ 미확정을 «따로» 적는다', () => {
    const line = renderJudgePredictionAccuracy({ predicted: 4, fulfilled: 0, missed: 3, pending: 1 });
    expect(line).toContain('3건 중 0건 적중');
    expect(line).toContain('3건 빗나감');
    expect(line).toContain('결과 미확정 1건');
    // ⛔ 「이러이러하게 판정하라」가 아니어야 한다.
    expect(line).toContain('사실 관측이지 판정 지시가 아니다');
  });

  test('⛔ 미확정이 «없으면» 그 괄호를 안 붙인다', () => {
    const line = renderJudgePredictionAccuracy({ predicted: 2, fulfilled: 1, missed: 1, pending: 0 });
    expect(line).not.toContain('결과 미확정');
  });
});

describe('«잴 자» — 되먹임 줄이 값을 냈는지 전/후로 비교할 수 있어야 한다', () => {
  test('⭐⭐ 판정 «직전» 값이어야 한다 — 이번 판정이 섞이면 「그때 무엇을 알았나」가 흐려진다', () => {
    // 🔑 orchestrator 는 supervisorDecisionHistory.push() «전»에 잰다.
    //   그 순서가 뒤집히면 아래 두 값이 «같아지고» 전/후 비교가 불가능해진다.
    const before = [d(1, 'EXTEND'), d(2, 'EXTEND')];
    const atDecisionTime = judgePredictionAccuracy(before);
    const afterPush = judgePredictionAccuracy([...before, d(3, 'EXTEND')]);

    expect(atDecisionTime).toEqual({ predicted: 2, fulfilled: 0, missed: 1, pending: 1 });
    expect(afterPush).toEqual({ predicted: 3, fulfilled: 0, missed: 2, pending: 1 });
    // ⛔ 둘이 «달라야» 한다 — 같으면 순서가 뒤집힌 것이다.
    expect(atDecisionTime).not.toEqual(afterPush);
  });

  test('⭐ 「빗나감 비율」은 «확정된 것»으로만 잰다 — 못 재는 상태를 0 으로 접지 않는다', () => {
    // ⛔ 앞 판은 resolved===0 일 때 0 을 돌려주면서 주석에 「못 잰다」라 적어 «뜻이 충돌»했다(리뷰 #10607).
    //   ⇒ 못 재면 undefined 를 낸다. 「비율 0(전부 적중)」과 「아직 잴 게 없다」는 다른 값이다.
    const missRate = (h: JudgeRoundDecision[]): number | undefined => {
      const a = judgePredictionAccuracy(h);
      const resolved = a.fulfilled + a.missed;
      return resolved === 0 ? undefined : a.missed / resolved;
    };
    expect(missRate([d(1, 'EXTEND'), d(2, 'EXTEND'), d(3, 'EXTEND'), d(4, 'EXTEND')])).toBe(1);
    expect(missRate([d(1, 'EXTEND'), d(2, 'SUFFICIENT')])).toBe(0);
    // ⛔ 확정된 것이 «없으면» 0 이 아니라 undefined — 이것이 전/후 비교의 분모를 지킨다.
    expect(missRate([d(1, 'EXTEND')])).toBeUndefined();
    expect(missRate([])).toBeUndefined();
  });
});

describe('판사가 «자기가 쓰는 수»를 본다 (🅕 발견 ①·②)', () => {
  test('⭐⭐ 반복 수 ⊕ must-fix 추세를 «사실»로 낸다', () => {
    const line = renderJudgeOwnSignals({ citedReviewSymbolRepeatCount: 2, mustFixTrend: [5, 3, 2, 3] });
    expect(line).toContain('심볼이 겹치는» 것: 2건');
    expect(line).toContain('5 → 3 → 2 → 3');
    // ⭐ 두 사실을 «따로» 적는다 — 「처음보다 줄었나」로 보면 5→3→2→3 을 «놓친다».
    expect(line).toContain('직전보다 «안 줄었다»(2 → 3)');
    expect(line).toContain('한 번도 0 에 안 닿았다');
    expect(line).toContain('사실 관측이지 판정 지시가 아니다');
  });

  test('⛔ 0 도 «싣는다» — 「반복 없음」이 사실이면 그것도 판사가 알아야 한다', () => {
    expect(renderJudgeOwnSignals({ citedReviewSymbolRepeatCount: 0 })).toContain('것: 0건');
  });

  test('⭐ 추세가 «내려가면» 경고를 안 붙인다 — 사실이 다르면 문면도 달라야 한다', () => {
    const line = renderJudgeOwnSignals({ mustFixTrend: [5, 3, 0] });
    expect(line).toContain('5 → 3 → 0');
    expect(line).not.toContain('안 줄었다');
    expect(line).not.toContain('0 에 안 닿았다');
  });

  test('⛔ 줄 것이 «없으면» 아무 줄도 안 낸다', () => {
    expect(renderJudgeOwnSignals({})).toBeUndefined();
    expect(renderJudgeOwnSignals({ mustFixTrend: [3] })).toBeUndefined();   // 한 점은 «추세가 아니다»
  });

  test('⛔ 이력에서 못 읽으면 «빈 배열» — 0 으로 채우지 않는다', () => {
    expect(mustFixTrendFromHistory(['- a\n- b', '- c'])).toEqual([2, 1]);
    expect(mustFixTrendFromHistory(['목록이 없는 산문'])).toEqual([]);
    expect(mustFixTrendFromHistory([])).toEqual([]);
  });
});
