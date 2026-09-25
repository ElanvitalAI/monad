// auto-review 기본 발동 (2026-07-27 · 대표 지시)
//
// 배경: 툴 설명은 *"Symmetric with the dev line"* 이라 적혀 있는데 **기본값이 비대칭**이었다.
// `monad dev` 는 auto-review 가 기본 on 인데 `RunDevHarness` 는 `auto_review` 를 명시해야만
// 켜져서, L2 자연어로 부르면 사실상 영영 안 켜졌다 — 실측: L2 가 RunDevHarness 를 호출했으나
// auto_review 미지정이라 PR 도 무인 리뷰도 안 붙고 `[deploy]` 에서 멈췄다.
//
// ⭐ auto-review 라벨 하나가 **머지까지** 넘긴다 — L3 폴러(`review-loop.ts`)가 라벨된 PR 을
//    rework→심판→`gh pr merge --squash` 로 완결한다. 그래서 별도 autoMerge 축이 없다.
//
// 계약: **기본 ON** · 사람이 "내가 직접 검토" 류로 말할 때만 OFF · 명시 파라미터가 최우선.

import { describe, expect, test } from 'bun:test';
import type { RunHarnessOnSurfaceOptions } from '../src/harness/harness-membrane.js';
import { dispatchRunDevHarness, resolveAutoReview } from '../src/skills/tools/dev-harness.js';

const on = (objective: string, userText?: string): boolean =>
  resolveAutoReview({ objective }, userText);

describe('resolveAutoReview — 기본 발동', () => {
  test('★평범한 개발 요청은 기본 ON (억제 표현 없음)', () => {
    for (const t of [
      '스트리밍 중 포커스 이탈 고쳐줘',
      'M1 문제 이제 해결해주세요',
      'PTY 로 재현해서 분석하고 수리해줘',
      'implement the sticky focus policy',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: true });
  });

  test('★빈 입력도 ON — "말 안 했으면 무인" 이 기본이다', () => {
    expect(resolveAutoReview({})).toBe(true);
  });
});

describe('resolveAutoReview — 억제 표현이 있을 때만 OFF', () => {
  test('★사람이 직접 보겠다는 의사', () => {
    for (const t of [
      '이건 내가 직접 검토할게',
      '수동으로 리뷰할게요',
      '매뉴얼로 검토하겠습니다',
      '리뷰는 사람이 검토하는 걸로',
      '손으로 리뷰할 테니 라벨 붙이지 마',
      'manual review only',
      'auto_review=off',
      'no-auto-review',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: false });
  });

  test('★원본 유저 메시지에서도 잡는다 (LLM 이 objective 에서 떼어내도)', () => {
    // resolveAutoDrive 와 동형 — objective 는 정제됐는데 원문에 의사가 있는 경우.
    expect(on('포커스 정책 구현', '이번 건은 내가 직접 검토할게')).toBe(false);
  });

  test('부정된 억제 표현은 무인 리뷰를 유지한다', () => {
    for (const t of [
      '직접 검토하지 말고 자동 리뷰해줘',
      'manual review는 하지 마',
      '수동으로 리뷰하지 않아도 돼',
      "don't do manual review",
      'do not do manual review',
      'no need to manually review',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: true });
  });

  test('1인칭 검토 의사는 무인 리뷰를 억제한다', () => {
    for (const t of [
      '제가 볼게요',
      '제가 확인하겠습니다',
      '내가 확인할게',
      "I'll review it myself",
      'let me review',
      'I will check it myself',
      '내가 직접 검토할게. 테스트 없이 배포하자',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: false });
  });

  test('★기능·설정 언급은 억제가 아니다 — 작업 대상이지 의사가 아니다', () => {
    // 억제 어휘가 **모드·설정 이름 그 자체**로 쓰이고 뒤에 기능/설정을 가리키는 말이 오면
    // 그건 "그 기능을 손봐 달라"는 작업 요청이지 "내가 보겠다"가 아니다.
    for (const t of [
      'manual review 기능을 자동화해줘',
      '수동으로 리뷰하는 기능을 없애줘',
      'auto_review=off로 하지 마',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: true });
  });

  test('⚠️ 기능명 예외가 1인칭 검토 의사를 삼키면 안 된다 — 위험 방향 고정', () => {
    // 바로 위 예외는 필연적으로 "억제 어휘 뒤에 명사가 오는 문장"을 다룬다. 그 범위가
    // 넓어지면 아래처럼 **뒤에 명사가 오지만 의사는 분명한** 문장까지 무인으로 새는데,
    // 그 방향이 이 축에서 위험하다 — auto-review 라벨은 L3 폴러가 받아 심판→
    // `gh pr merge --squash` 까지 완결하므로 사람이 보겠다는 말을 놓치면 **사람 확인 없이
    // 머지**된다. 뮤테이션 실증: 앵커 가드를 빼면 `할 코드`가 기능 지칭에 걸려 이 테스트만
    // 실패한다.
    for (const t of [
      '내가 검토할 코드는 이거야',
      '제가 확인할 코드는 이 PR입니다',
    ]) expect({ t, on: on(t) }).toEqual({ t, on: false });
  });

  test('⚠️ "리뷰 없이" 는 억제가 아니다 — 다른 뜻(리뷰 자체를 건너뛰라)', () => {
    // 무인 리뷰를 끄라는 말이 아니므로 기본 ON 을 유지한다. 오탐 경계 고정.
    expect(on('리뷰 없이 빨리 가자')).toBe(true);
  });
});

describe('dispatchRunDevHarness — 해석한 autoReview 전달', () => {
  test('사람 검토 의사는 생략하고 부정된 검토 의사는 true로 전달한다', async () => {
    const received: RunHarnessOnSurfaceOptions[] = [];
    const deps = {
      seamsFactory: () => ({}) as never,
      runHarness: async (opts: RunHarnessOnSurfaceOptions) => {
        received.push(opts);
        return { ok: true, terminal: 'no-changes' as const, rounds: 0 };
      },
    };
    await dispatchRunDevHarness({ objective: '제가 확인하겠습니다' }, undefined, deps);
    await dispatchRunDevHarness({ objective: "don't do manual review" }, undefined, deps);
    expect(received[0]?.autoReview).toBeUndefined();
    expect(received[1]?.autoReview).toBe(true);
  });
});

describe('resolveAutoReview — 명시 파라미터가 최우선', () => {
  test('★false 명시는 억제 표현이 없어도 OFF', () => {
    expect(resolveAutoReview({ auto_review: false, objective: '고쳐줘' })).toBe(false);
  });

  test('★true 명시는 억제 표현이 있어도 ON', () => {
    expect(resolveAutoReview({ auto_review: true, objective: '내가 직접 검토할게' })).toBe(true);
  });

  test('boolean 이 아닌 값은 명시로 보지 않는다 (텍스트 판정으로 내려감)', () => {
    expect(resolveAutoReview({ auto_review: 'yes' as unknown, objective: '내가 직접 검토할게' })).toBe(false);
  });
});
