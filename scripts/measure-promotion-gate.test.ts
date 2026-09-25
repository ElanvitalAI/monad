import { test, expect, describe } from 'bun:test';
import { judgeSample } from './measure-promotion-gate.js';

const P = (id: string, dependsOn: string[] = [], hotPaths?: string[]) => ({
  id, feature: `feat ${id}`, dependsOn, ...(hotPaths ? { hotPaths } : {}),
});

describe('judgeSample — 두 관문을 «같은 표본»에 나란히 누른다', () => {
  // ⛔ 자를 쓰기 «전»에 알려진 양성·음성 양쪽에 눌러 본다 — 자가 깨지면 「0%」 칸이 전부 통과한다.
  test('알려진 양성 — 의존 0 뿐이면 «두 관문 다» 통과한다', () => {
    const v = judgeSample([P('a'), P('b')]);
    expect(v.legacyPromotable).toBe(true);
    expect(v.dagPromotable).toBe(true);
  });

  // ⭐ 이것이 이 자가 재려는 «바로 그 칸»이다 — 옛 관문 거부 ↔ 새 관문 통과.
  test('알려진 차이 — 의존이 있으면 옛 관문은 «거부» · 새 관문은 «통과»', () => {
    const v = judgeSample([P('a'), P('b', ['a'])]);
    expect(v.legacyPromotable).toBe(false);
    expect(v.dagPromotable).toBe(true);
    expect(v.dependsOnEdges).toBe(1);
  });

  test('알려진 음성 — 순환이면 «두 관문 다» 거부하고 순환을 이름으로 낸다', () => {
    const v = judgeSample([P('a', ['b']), P('b', ['a'])]);
    expect(v.legacyPromotable).toBe(false);
    expect(v.dagPromotable).toBe(false);
    expect(v.cycle?.sort()).toEqual(['a', 'b']);
  });

  test('조각이 «하나»면 어느 관문도 통과시키지 않는다 — 분해가 아니다', () => {
    const v = judgeSample([P('a')]);
    expect(v.legacyPromotable).toBe(false);
    expect(v.dagPromotable).toBe(false);
  });

  test('hotPaths 겹침은 간선으로 세어지고 통과를 «막지 않는다»', () => {
    const v = judgeSample([P('a', [], ['src/x.ts']), P('b', [], ['src/x.ts'])]);
    expect(v.dagPromotable).toBe(true);
    expect(v.hotPathEdges).toBe(1);
  });
});
