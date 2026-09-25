import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGraphTemplateYaml } from '../src/self-implement/graph-yaml.js';
import { defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { SUPERVISOR_ACTIONS, SUPERVISOR_STOP_REASONS } from '../src/self-dev/run-supervisor.js';
import { goalCauseObservedFromFailureClassification, triageActionFor } from '../src/self-dev/orchestrate.js';

/** ⭐ 「선언한 셀프힐 결과 중 «아무도 못 내는» 것」을 «센다».
 *
 *  🩸 2026-09-08: `default-loop.yaml` 의 heal 노드가 다섯을 선언했는데 ***생산자가 하나도 없었다***
 *    (`heal_action` 이 `src/` 전체에 0건). 실제 어휘는 `relaunch | add-repair-task | stop:<사유 일곱>` 이다.
 *    ⇒ 선언과 실행이 «다른 낱말»을 쓰는데 시험은 전부 초록이었다 — 선언을 읽고 선언을 물었으니까.
 *
 *  ⛔ 이 자는 「따르는 수」가 아니라 «못 내는 수»를 센다 — 따르는 수는 좋은 변경으로도 자란다.
 *  ⛔ 아직 못 내는 것을 «지워서» 통과시키지 않는다(대표 이 요구한 능력이다). 수가 «줄기만» 하면 된다. */
describe('heal 결과에 생산자가 있나', () => {
  const spec = parseGraphTemplateYaml(
    readFileSync(join(defaultGraphsDir(), 'default-loop.yaml'), 'utf8'), 'default-loop.yaml',
  ).template;
  const healOutcomes = Object.keys(spec!.edges.find((e) => e.from === 'heal')?.map ?? {});

  /** ⭐⭐ 선언된 결과의 «상태» — ⛔ 참/거짓 «둘»이 아니라 **셋**이다.
   *
   *  🩸 이 자는 오늘 «두 번» 뒤집혔고 두 번 다 같은 이유였다:
   *    ***내가 「내가 아는 이름」이 안 보이면 「능력이 없다」로 읽었다.***
   *    ⑴ `re-decompose`  → 실제로는 `decompose-and-retry` 로 **44회** 나고 있었다
   *    ⑵ `re-author`     → 실제로는 `goal-unconvergeable-candidate` 가 **22/98(22%)** 나고 있었다
   *
   *  ⇒ 그래서 판정을 «이름»이 아니라 ***「그 체인이 서는가」***로 바꾸고, 값을 셋으로 갈랐다:
   *    produced  신호가 나고 그 결과로 «이어진다»
   *    shadowed  ⭐ 신호는 «나는데» 다른 분기가 «먼저 이겨» 그 결과가 안 나온다
   *    absent    대응 개념이 «없다»
   *  ⛔ `shadowed` 를 `absent` 와 같은 칸에 두면 ***처방이 갈리지 않는다*** —
   *    전자는 「분기 순서·행동 매핑」을 고치는 일이고, 후자는 「개념을 짓는」 일이다. */
  type OutcomeState = 'produced' | 'shadowed' | 'absent';

  const stateOf = (outcome: string): OutcomeState => {
    switch (outcome) {
      case 'retry':
        return (SUPERVISOR_ACTIONS as readonly string[]).includes('relaunch') ? 'produced' : 'absent';
      case 'escalate':
        return (SUPERVISOR_ACTIONS as readonly string[]).includes('stop') ? 'produced' : 'absent';
      case 're-decompose':
        // 📏 원장 전 우주 30일 «44회». 체인: unconverged-decomposable → decompose-and-retry
        return triageActionFor('unconverged-decomposable') === 'decompose-and-retry' ? 'produced' : 'absent';
      case 're-author':
        // 📏 `goal-unconvergeable-candidate` 가 abandoned 분류 98건 중 «22건»(런 15개).
        //   ⛔ FailureKind 단계에서 `decomposable` 분기가 «먼저 이긴다» ⇒ shadowed.
        //   ✅⭐ 그런데 그 가림이 «옳다» — 실측: 그 15런이 ***15/15 전부*** decomposable 이었고
        //     kinds 도 `unconverged-decomposable:decompose-and-retry` 27 ↔ `unconverged:rework` 1 이었다.
        //     ⇒ 「골이 크다 ⊕ 쪼갤 수 있다」면 ***먼저 쪼개는 것이 맞다***.
        //   📌 ⇒ ***`shadowed` 가 곧 「고칠 것」은 아니다.*** 처방은 「분기 순서를 바꿔라」가 아니라
        //     ***「가림이 정당한지 재라」***이고, 이 축에서는 「정당하다」가 답이었다.
        //   ⚠️ 뒤집힐 조건은 하나다: 「골이 큰데 «쪼갤 수 없는»」 표본이 나오는 것(현재 0/15).
        return goalCauseObservedFromFailureClassification('goal-unconvergeable-candidate') === true
          && triageActionFor('oversized-goal') === 'add-repair-task'
          ? 'shadowed' : 'absent';
      default:
        return 'absent';   // `re-plan` — 대응 개념이 «없다»
    }
  };

  it('⛔ 「못 내는」 결과 수가 «알려진 것»보다 늘지 않는다', () => {
    const byState = { produced: [] as string[], shadowed: [] as string[], absent: [] as string[] };
    for (const o of healOutcomes.sort()) byState[stateOf(o)].push(o);
    // ⛔ 세 칸을 «한 번에» 못 박는다 — 하나로 접으면 처방이 갈리지 않는다.
    expect(byState).toEqual({
      produced: ['escalate', 're-decompose', 'retry'],
      shadowed: ['re-author'],     // ⭐ 신호는 «난다»(22/98) — 분기가 가릴 뿐이다
      absent:   ['re-plan'],       // ⛔ 대응 «개념»이 없다 — 이것만 「짓는」 일이다
    });
  });

  it('⛔ 반증 — 이 자가 «항상 통과»하지 않는다(없는 결과는 못 낸다고 답한다)', () => {
    expect(stateOf('no-such-outcome')).toBe('absent');
    expect(stateOf('retry')).toBe('produced');
  });

  it('⛔⭐ re-decompose 는 «이름이 아니라 신호»로 판정한다 — 판정을 그 함수에 «묻는다»', () => {
    // 🪞 처음에 나는 `heal_action` 이 0건인 것을 보고 이것을 「없다」로 셌다. 틀렸다.
    expect(triageActionFor('unconverged-decomposable')).toBe('decompose-and-retry');
    expect(stateOf('re-decompose')).toBe('produced');
  });

  it('⛔ 반대 방향 — supervisor 가 내는데 선언에 «없는» 것도 남는다', () => {
    // `add-repair-task` 는 실제 산출인데 이 그래프에 대응 노드가 없다. 그 사실을 값으로 못 박는다.
    expect(SUPERVISOR_ACTIONS).toContain('add-repair-task');
    expect(healOutcomes).not.toContain('add-repair-task');
  });

  it('stop 사유는 «닫힌 집합»이고 값과 타입이 같이 산다', () => {
    expect(SUPERVISOR_STOP_REASONS.length).toBeGreaterThan(0);
    expect(new Set(SUPERVISOR_STOP_REASONS).size).toBe(SUPERVISOR_STOP_REASONS.length);
  });
});
