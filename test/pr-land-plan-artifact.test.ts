import { describe, expect, it } from 'bun:test';
import { planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding } from '../src/cli/pr-cli.js';

describe('planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding', () => {
  // ⛔⭐ 🚨 실측 정정(2026-09-07): 초판 시험은 «지어낸 문면»(`골/grounding 없이 만들어졌다`)을 썼다.
  //    ***그 문장은 실물 오염 문서 72개 중 «0건»이었다.***
  //    ⇒ 자와 시험이 «같은 상상»을 공유해서, 초록인데 미탐이 100% 였다.
  //    🔑 이것이 「전제를 목으로 세운 신호는 아무것도 못 잰다」의 실물이다.
  // ✅ 아래 본문은 ***실제 오염 문서에서 그대로 옮긴 것***이다.
  it('matches a document whose body self-declares it was created without a goal/grounding', () => {
    const body = [
      '# RFC — 빌드 가능한 계획의 범위와 근거 확정',
      '',
      '## 0. 왜(근거)',
      '',
      '요청된 골은 `write a plan`이지만, 계획 대상 기능·저장소 구조·기존 심볼·파일·완료 조건에 관한 '
        + 'historian 조사 재료가 제공되지 않았다. 따라서 현재 정보만으로 구현 경계나 재사용 지점을 특정하면 '
        + '추측에 의존하게 되며, 이후 재분해를 유발한다.',
      '',
    ].join('\n');
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body })).toBe(true);
  });

  // ⭐ 음성 — 두 낱말이 «다른 문장»에 흩어져 있으면 근거가 아니다.
  it('does not match when the two markers sit in different sentences', () => {
    const body = [
      '# RFC-legitimate-2026-09-07',
      '',
      '이 문서는 `write a plan` 이라는 골 문면을 인용한다.',
      '',
      '별개로, 어제 측정에서 일부 값이 제공되지 않았다.',
      '',
    ].join('\n');
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body })).toBe(false);
  });

  // ⭐ 음성 — 순서가 뒤집히면 근거가 아니다(「제공되지 않았다 … write a plan」).
  it('does not match when the markers appear in reverse order', () => {
    const body = '자료가 제공되지 않았다는 지적에 따라 `write a plan` 을 다시 썼다.';
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body })).toBe(false);
  });

  it('does not match a legitimate RFC whose body does not self-declare ungrounded authorship', () => {
    const body = [
      '# RFC-git-control-as-logic-not-discipline-2026-08-09',
      '',
      '이 RFC 는 기존 골과 grounding 증거 위에서 착지 규율을 설계한다.',
      'Persistent grounding evidence 는 src/cli/pr-cli.ts 의 runPrLand 이다.',
      '',
    ].join('\n');
    expect(body.includes('골/grounding 없이 만들어졌다')).toBe(false);
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body })).toBe(false);
  });

  it('does not match an empty file', () => {
    const fileName = 'PLAN-empty.md';
    expect(fileName).toBe('PLAN-empty.md');
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body: '' })).toBe(false);
  });

  it('does not match a similarly named file whose body does not contain the evidence phrase', () => {
    const fileName = 'PLAN-created-without-goal-grounding.md';
    const body = [
      '# PLAN-created-without-goal-grounding',
      '',
      '이름은 골/grounding 부재처럼 보이지만 본문은 기존 RFC 를 인용한 정당한 계획이다.',
      '',
    ].join('\n');
    expect(fileName).toContain('without-goal-grounding');
    expect(body.includes('골/grounding 없이 만들어졌다')).toBe(false);
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body })).toBe(false);
  });
});

// ⛔⭐⭐ **실물 코퍼스 회귀** — 무인 리뷰가 잡은 GOODHART: 인라인 문면 «하나»로는
//   ***「오염 72개 중 63개」라는 핵심 측정을 재현·보장하지 못한다.***
//   ⇒ 실제 오염 문서들에서 «그대로 옮긴» 여섯 변형을 픽스처로 박는다.
//   📌 워크트리 코퍼스는 사라지므로 «경로»가 아니라 «본문»을 박는다 —
//     그래야 다음 창이 이 시험만으로 재현한다.
//   🩸 초판이 이 자리를 «지어낸 문장 하나»로 채워서 미탐 100% 였다.
describe('실물 코퍼스에서 옮긴 변형들', () => {
  const REAL_UNGROUNDED_SENTENCES = [
    '현재 제공된 골은 `write a plan`뿐이며, 계획이 다룰 제품 동작·저장소·변경 요청·완료 조건은 제공되지 않았다.',
    '현재 제공된 골은 `write a plan`뿐이며, 계획의 대상·저장소·완료 조건·일정·담당 주체에 관한 grounding 재료는 제공되지 않았다.',
    '현재 제공된 골은 `write a plan`뿐이며, 대상 기능·저장소 경로·기존 심볼·제약을 구체화할 historian 조사 재료는 제공되지 않았다.',
    '현재 제공된 골은 `write a plan`뿐이며, 대상 기능·저장소·변경 범위·기존 파일과 심볼·historian 조사 재료가 제공되지 않았다.',
    '현재 제공된 골은 `write a plan`뿐이며, 계획 대상 기능, 저장소 구조, historian 조사 재료, 수정 가능한 파일·심볼이 제공되지 않았다.',
    '요청된 골은 `write a plan`이지만, 계획 대상 기능·저장소 구조·기존 심볼·파일·완료 조건에 관한 historian 조사 재료가 제공되지 않았다.',
  ] as const;

  it('여섯 변형을 «전부» 문다 — 하나라도 놓치면 그만큼 미탐이다', () => {
    const missed = REAL_UNGROUNDED_SENTENCES.filter((sentence) =>
      !planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({
        body: `# RFC — 계획\n\n## 0. 왜(근거)\n\n${sentence}\n`,
      }));
    expect(missed).toEqual([]);
  });

  // ⭐ 이 시험이 «자를 되돌리면 깨지는지»를 스스로 말한다 —
  //   초판 표식('골/grounding 없이 만들어졌다')은 위 여섯 중 «하나도» 안 문다.
  it('초판의 «지어낸» 표식은 실물 여섯 중 하나도 못 문다', () => {
    const fabricated = '골/grounding 없이 만들어졌다';
    const hits = REAL_UNGROUNDED_SENTENCES.filter((s) => s.includes(fabricated));
    expect(hits).toEqual([]);
  });
});

// ⛔⭐⭐ **이 자가 «못 하는 것»을 시험으로 굳힌다** (무인 리뷰 2차)
//   🩸 앞 판의 경고 문면은 「골이 `write a plan` 뿐이었다」고 «단언»했다.
//     ⇒ 그런데 이 자는 그것을 «증명하지 못한다». 아래가 그 반례이고, ***매치된다***.
//   ⇒ 그래서 자를 좁히는 대신 ***출력을 「한 문장 안에 그 순서로 있다」는 근거 수준으로 낮췄다***
//     (좁히면 실물 변형 여섯 종을 놓친다).
//   📌 이 시험은 「고쳐라」가 아니라 ***「이 자의 한계가 여기다」***를 못 박는 것이다.
describe('이 자가 «못 하는 것» — 문면을 다시 올리지 마라', () => {
  it('「그것뿐」이 아닌 문장도 매치된다 — 그래서 경고가 단정하지 않는다', () => {
    const counterexample = '`write a plan` 외 구현도 요청됐지만 historian 재료는 제공되지 않았다.';
    expect(planArtifactBodyDeclaresCreatedWithoutGoalOrGrounding({ body: counterexample })).toBe(true);
  });
});
