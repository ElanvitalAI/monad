import { describe, expect, it } from 'bun:test';
import { loadGraphOverlays, defaultOverlaysDir } from '../src/self-implement/graph-overlay-yaml.js';
import { activeTemplate, resolveGraphAuthority } from '../src/self-implement/graph-authority.js';
import type { GoalType } from '../src/self-implement/goal-author.js';

/** ⭐ 「선언은 있고 «닿지 않는» 것」을 «세는» 자.
 *
 *  🩸 2026-09-08: 오버레이 둘이 «둘 다» `default-loop` 을 겨눴는데
 *    ***`default-loop` 은 활성 템플릿이 «될 수 없다»*** — `activeTemplate` 이 고르는 것은
 *    `self-implement` 또는 `research-loop` 뿐이다. ⇒ 기계는 도는데 얹힐 판이 «원리상» 없었다.
 *  ⛔ 이 자는 「따르는 수」가 아니라 «닿지 않는 수»를 센다 — 따르는 수는 좋은 변경으로도 자란다. */

/** 활성이 «될 수 있는» graphId 전부. ⛔ 목록을 손으로 적지 않고 «판정 함수»에 물어 만든다. */
function reachableGraphIds(): Set<string> {
  const on = resolveGraphAuthority({ flag: true });
  const goalTypes: (GoalType | undefined)[] = ['implement', 'research', undefined];
  return new Set(goalTypes.map((t) => activeTemplate(t, on).graphId));
}

describe('오버레이 도달 가능성', () => {
  const overlays = loadGraphOverlays(defaultOverlaysDir()).overlays;

  it('⛔ 「닿지 않는」 오버레이 수가 «알려진 것»보다 늘지 않는다', () => {
    const reachable = reachableGraphIds();
    const unreachable = overlays.filter((o) => !reachable.has(o.target)).map((o) => o.overlayId);
    // 📌 알려진 하나 = heal-patient(그 파일 머리말이 세 이유를 적는다). 늘면 이 시험이 문다.
    expect(unreachable).toEqual(['heal-patient']);
  });

  it('⛔ 반증 — 이 자가 «항상 통과»하지 않는다(닿지 않는 target 을 넣으면 잡는다)', () => {
    const reachable = reachableGraphIds();
    expect(reachable.has('no-such-graph')).toBe(false);
    expect(reachable.has('default-loop')).toBe(false);   // 🔑 이것이 오늘의 사고였다
  });

  it('rework-patient는 enabled authority의 activeTemplate에서 도달한다', () => {
    const reachable = reachableGraphIds();
    const patient = overlays.find((overlay) => overlay.overlayId === 'rework-patient');
    expect(patient).toBeDefined();
    expect(reachable.has(patient?.target ?? '')).toBe(true);
  });

  it('활성이 될 수 있는 것은 «판정 함수»가 말한다 — 목록을 손으로 적지 않는다', () => {
    expect(reachableGraphIds().has('self-implement')).toBe(true);
  });
});
