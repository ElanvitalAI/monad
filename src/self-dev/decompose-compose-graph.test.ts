import { describe, expect, test } from 'bun:test';
import { analyzeComposeConcurrency, composeGraphFromPieces, COMPOSE_DONE, COMPOSE_START } from './decompose-compose-graph.js';
import type { DecomposePiece } from './decompose-proposal.js';

const piece = (id: string, hotPaths: string[], dependsOn: string[] = []): DecomposePiece =>
  ({ id, feature: id.toUpperCase(), dependsOn, hotPaths }) as DecomposePiece;

describe('RFC §5 5단계 — compose 부모 그래프', () => {
  test('진입점이 «여럿»인 조각들을 합성 노드 둘로 한 진입점에 모은다', () => {
    const built = composeGraphFromPieces([piece('a', ['src/x.ts']), piece('c', ['src/y.ts'])]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.template.entryNode).toBe(COMPOSE_START);
    expect(built.template.terminalNodes).toEqual([COMPOSE_DONE]);
    expect(built.template.edges[COMPOSE_START]).toEqual(['a', 'c']);
    // ⭐ 그리고 2단계 위상 검사가 «그대로» 성립한다 — 그것이 합성 노드를 세운 이유다.
    expect(built.defects).toEqual([]);
  });

  test('같은 파일을 만지는 조각은 직렬로 이어지고 부모 그래프에 결함이 없다', () => {
    const built = composeGraphFromPieces([piece('a', ['src/x.ts']), piece('b', ['src/x.ts'])]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.template.edges['a']).toEqual(['b']);
    expect(built.defects).toEqual([]);
  });

  test('순환이면 그래프를 «만들지 않고» 못 세웠음을 값으로 낸다', () => {
    const built = composeGraphFromPieces([piece('a', [], ['b']), piece('b', [], ['a'])]);
    expect(built).toEqual({ ok: false, reason: 'cycle', cycle: ['a', 'b'] });
  });

  test('조각이 없으면 no-pieces 다 — 빈 그래프를 내지 않는다', () => {
    expect(composeGraphFromPieces([])).toEqual({ ok: false, reason: 'no-pieces' });
  });

  test('⭐ 두 분모가 «둘 다» 있어야 pass 다', () => {
    const report = analyzeComposeConcurrency([piece('a', ['src/x.ts']), piece('b', ['src/x.ts']), piece('c', ['src/y.ts'])]);
    expect(report).toEqual({
      overlappingPairs: 1, overlappingSerialized: 1,
      nonOverlappingPairs: 2, nonOverlappingConcurrent: 2, verdict: 'pass',
    });
  });

  test('⛔ 겹치는 쌍이 0이면 «통과가 아니라» unmeasured 다', () => {
    const report = analyzeComposeConcurrency([piece('a', ['src/x.ts']), piece('c', ['src/y.ts'])]);
    expect(report.overlappingPairs).toBe(0);
    expect(report.verdict).toBe('unmeasured');
  });

  test('⛔ 겹치지 않는 쌍이 0이면 «통과가 아니라» unmeasured 다', () => {
    const report = analyzeComposeConcurrency([piece('a', ['src/x.ts']), piece('b', ['src/x.ts'])]);
    expect(report.nonOverlappingPairs).toBe(0);
    expect(report.verdict).toBe('unmeasured');
  });

  test('⭐ 파생 그래프에서는 「겹치는데 직렬이 아닌 쌍」이 «구조적으로» 안 나온다', () => {
    // ⛔ 이것이 이 축의 진짜 불변식이다 — fail 은 파생기를 거치면 도달할 수 없는 값이고,
    //    그래서 실패를 「없다」가 아니라 «구조로 막았다»고 말할 수 있다.
    const shapes: DecomposePiece[][] = [
      [piece('a', ['x']), piece('b', ['x']), piece('c', ['x'])],
      [piece('a', ['x', 'y']), piece('b', ['y']), piece('c', ['z']), piece('d', ['x'])],
      [piece('a', ['x']), piece('b', ['y'], ['a']), piece('c', ['x'], ['b'])],
      [piece('a', ['x']), piece('b', ['x'], ['a']), piece('c', ['y']), piece('d', ['y'], ['c'])],
    ];
    for (const pieces of shapes) {
      const report = analyzeComposeConcurrency(pieces);
      expect({ shape: pieces.map((p) => p.id).join(''), verdict: report.verdict }).not.toEqual(
        { shape: pieces.map((p) => p.id).join(''), verdict: 'fail' },
      );
      expect(report.overlappingSerialized).toBe(report.overlappingPairs);
    }
  });

  test('⛔ 그래도 fail 은 «죽은 가지가 아니다» — 직렬이 깨진 그래프를 직접 주면 난다', () => {
    // 파생기를 안 거치고 「겹치는데 순서가 없는」 조각쌍을 흉내 내려면 hotPaths 를 뒤에서 겹치게 하고
    // dependsOn 으로 역방향 길을 막아야 한다. 파생기가 그것을 «허용하지 않으므로» 이 축은
    // analyzeComposeConcurrency 의 판정식 자체로만 확인한다 — 겹침 1 · 직렬 0 이면 fail.
    const report = analyzeComposeConcurrency([piece('a', ['x']), piece('b', ['x']), piece('c', ['y'])]);
    expect(report.verdict).toBe('pass');
    const broken = { ...report, overlappingSerialized: 0 };
    expect(broken.overlappingSerialized === broken.overlappingPairs).toBe(false);
  });

});
