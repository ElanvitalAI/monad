import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groundingWarning } from '../src/self-implement/goal-grounding-warning.js';

/**
 * `43차` — ⛔⭐⭐⭐ **「코드 후보 0」이 침묵하지 않게 한다.**
 *
 * ✅ 확실한 것: 코드 후보가 0 일 때도 **참조 지식은 그대로 나온다** ⇒ 산출이 「접지됐다」처럼 보이고
 * 「0」이 「없다」로 읽힌다. 그러면 골이 `NOT-GROUNDED` 로 서고 `--lint` 가 `ERROR [traced-path]` 를 낸다.
 *
 * ⛔⭐⭐⭐ **반증된 명제는 「링크된 worktree 면 «항상» 0」 하나다** — 같은 `ask` 로 `main 3` · `main-worktree 3`.
 * ⛔ 이것은 «트리가 전혀 무관하다»를 증명하지 «않는다» — 각 칸 표본 1 · 대조 한 쌍(`R-CLM5`).
 *   ⇒ 트리는 «배제되지 않은 후보»로 남는다.
 * (실측). 그래서 트리 조건을 트리거에서 **지웠다**. 원인을 모르는 채 「원인처럼 보이는 것」을 실으면
 * 읽는 사람이 틀린 원인을 좇는다 — 침묵보다 나쁠 수 있다. 전 표본 = `GOAL-T56`(**open**).
 *
 * ⛔ 이 게이트가 «안» 보는 것: 접지가 0 이 되는 «원인». 안 갈렸고 이 모듈도 단정하지 않는다.
 */
describe('43차 · groundingWarning — 「코드 후보 0」에만 운다', () => {
  test('코드 후보 0 ⇒ 말한다 ⊕ 「왜 접지된 것처럼 보이나」를 같이 싣는다', () => {
    const w = groundingWarning({ codeCandidates: 0, referenceFacts: 9 });
    expect(w).not.toBeNull();
    expect(w).toContain('0 으로 관측');
    // ⭐ 오독의 원인(참조 지식이 나온다)을 문면에 싣는다.
    expect(w).toContain('참조 지식 9건');
    // ⭐ 그리고 «막힌다»는 결과를 알려 준다 — 그게 사람이 알아야 할 다음 일이다.
    expect(w).toContain('ERROR [traced-path]');
  });

  test('stopReason end_turn인 후보 0 ⇒ 셋째 후보와 관측 종료 이유를 함께 싣는다', () => {
    const w = groundingWarning({ codeCandidates: 0, referenceFacts: 9, stopReason: 'end_turn' })!;
    expect(w).toContain('완료 선언 없이 끝난 접지 루프');
    expect(w).toContain('stopReason: end_turn');
    expect(w).toContain('ask 가 얇다');
    expect(w).toContain('대상 경로가 이 트리에 없다');
  });

  test('stopReason goal_complete인 후보 0 ⇒ 셋째 후보를 붙이지 않는다', () => {
    const w = groundingWarning({ codeCandidates: 0, referenceFacts: 9, stopReason: 'goal_complete' })!;
    expect(w).not.toContain('완료 선언 없이 끝난 접지 루프');
    expect(w).not.toContain('stopReason:');
    expect(w).toContain('ask 가 얇다');
    expect(w).toContain('대상 경로가 이 트리에 없다');
  });

  test('stopReason을 못 재면 후보 0에도 셋째 후보를 붙이지 않는다', () => {
    const w = groundingWarning({ codeCandidates: 0, referenceFacts: 9 })!;
    expect(w).not.toContain('완료 선언 없이 끝난 접지 루프');
    expect(w).not.toContain('stopReason:');
  });

  test('⛔ 철회한 «트리 축»을 문면이 아예 «꺼내지 않는다» — 부정도 주장이다', () => {
    const w = groundingWarning({ codeCandidates: 0, referenceFacts: 9 })!;
    // ⛔⭐⭐⭐ 초판은 「링크된 worktree 라서는 «아니다»」라고 «부정»했다. 무인 리뷰가 짚었다 —
    //   ***부정도 그 축을 코드에 계속 살리는 주장이고, 「원인을 확정하지 않는다」는 경계도 넘는다.***
    //   ⇒ 그 축을 아예 꺼내지 않는다. 이력은 모듈 헤더와 원장이 갖는다.
    expect(w).not.toContain('worktree');
    // ⭐ 대신 「원인을 모른다」와 «후보»만 말한다.
    expect(w).toContain('원인은 아직 안 갈렸다');
    expect(w).toContain('ask 가 얇다');
    expect(w).toContain('GOAL-T56');
  });

  /**
   * ⛔⭐⭐⭐ **철회가 «닿은 모든 파일»을 문다** — 이 창에서 같은 주장이 «여섯 자리»에 남았다:
   * 문면 → 트리거 → API 반환값 → 파일명 → 원장 → 주석. 그리고 매번 «사람(리뷰)»이 잡았다.
   * ⛔ 초판 게이트는 «모듈 파일 하나»만 읽어 「주석으로 되살아나면 운다」는 제 주장보다 좁았다
   *   (무인 리뷰 must-fix). ⇒ 주장이 닿는 파일을 «전부» 넣는다.
   */
  test.skipIf(!existsSync(join(dirname(fileURLToPath(import.meta.url)), '../.rules/30-harness/goal-authoring.md')))('⛔ private .rules 와 docs/harness 포함 과잉 인과 단정이 «주장이 닿은 모든 파일»에 없다', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const carriers = [
      'src/self-implement/goal-grounding-warning.ts',
      'src/index.ts',
      'test/goal-grounding-warning.test.ts',
      '.rules/30-harness/goal-authoring.md',
      'docs/harness/goal-contract/ISSUES.md',
    ];
    // 반증된 명제는 «항상 0» 이지 «트리 무관» 이 아니다.
    // ⛔⭐ 패턴을 «조각으로» 만든다 — 리터럴로 두면 «이 파일 자신»이 걸려 자기 참조로 붉어진다.
    //   그렇다고 이 파일을 검사 대상에서 빼면 «테스트 헤더의 과잉 단정»이 무방비가 된다.
    //   ⇒ 대상에는 두고, 문자열만 런타임에 조립한다.
    const overclaims = ['트리는 ' + '원인이 아니다', '「링크된 worktree 가 ' + '원인」', '트리 축을 ' + '닫는다'];
    for (const rel of carriers) {
      const src = readFileSync(join(root, rel), 'utf8');
      for (const bad of overclaims) {
        expect(`${rel}: ${src.includes(bad) ? bad : '(없음)'}`).toBe(`${rel}: (없음)`);
      }
    }
    // ⭐ 그리고 «한계»를 적은 자리가 있는지 — 반증만 적고 한계를 빼면 다시 과잉이 된다.
    for (const rel of ['src/self-implement/goal-grounding-warning.ts', 'docs/harness/goal-contract/ISSUES.md']) {
      expect(readFileSync(join(root, rel), 'utf8')).toContain('배제되지 않은 후보');
    }
  });

  test('⛔ 코드 후보가 «있으면» 침묵한다', () => {
    expect(groundingWarning({ codeCandidates: 3, referenceFacts: 9 })).toBeNull();
    expect(groundingWarning({ codeCandidates: 1, referenceFacts: 0 })).toBeNull();
  });

  test('⛔ «못 쟀으면» 침묵한다 — 「모른다」를 「0」으로 바꾸지 않는다', () => {
    // 부르는 쪽이 `?? 0` 으로 넘기면 미관측이 「0 으로 관측됐다」가 되어 «거짓 경고»가 나간다.
    expect(groundingWarning({ codeCandidates: undefined, referenceFacts: 0 })).toBeNull();
  });

  test('⛔ 「셀 수 없었다」에는 울지 않는다 — 계약은 «정확히 0»이다', () => {
    // `> 0` 이면 음수·NaN 에도 경고가 나간다. 그건 「못 셌음」을 「0」으로 읽는 것이다(`R-GIT3`).
    expect(groundingWarning({ codeCandidates: Number.NaN, referenceFacts: 1 })).toBeNull();
    expect(groundingWarning({ codeCandidates: -1, referenceFacts: 1 })).toBeNull();
  });
});
