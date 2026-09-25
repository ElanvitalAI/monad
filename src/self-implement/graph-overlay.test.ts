import { describe, expect, test } from 'bun:test';
import { applyOverlay, overlayPreservesNodeSet, type GraphOverlay } from './graph-overlay.js';
import { GRAPH_TEMPLATES, type GraphTemplate } from './graph-templates.js';
import { decideTemplate, resolveGraphAuthority } from './graph-authority.js';

const research = GRAPH_TEMPLATES['research-loop'] as GraphTemplate;
const implement = GRAPH_TEMPLATES['self-implement'] as GraphTemplate;
const reworkAtTwo: GraphTemplate = {
  ...implement,
  nodes: implement.nodes.map((node) => node.nodeId === 'rework' ? { ...node, maxVisits: 2 } : node),
};

describe('RFC §5 4단계 — 상황 오버레이', () => {
  test('max_visits 만 바꾸는 오버레이는 통과하고 노드 집합을 «안 바꾼다»', () => {
    const result = applyOverlay(research, { overlayId: 'patient', maxVisits: { investigate: 9 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(overlayPreservesNodeSet(research, result.template)).toBe(true);
    expect(result.template.nodes.find((n) => n.nodeId === 'investigate')?.maxVisits).toBe(9);
    // 판이 원장에서 구분되게 오버레이 이름이 version 에 남는다.
    expect(result.template.version).toBe(`${research.version}+patient`);
  });

  test('성공 maxVisits 패치는 바뀐 노드의 전후값을 함께 남긴다', () => {
    const result = applyOverlay(reworkAtTwo, { overlayId: 'rework-patient', maxVisits: { rework: 5 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patches).toEqual([{ overlayId: 'rework-patient', field: 'maxVisits', node: 'rework', before: 2, after: 5 }]);
  });

  test('같은 maxVisits 선언은 패치로 세지 않는다', () => {
    const before = reworkAtTwo.nodes.find((node) => node.nodeId === 'rework')?.maxVisits;
    const result = applyOverlay(reworkAtTwo, { overlayId: 'same', maxVisits: { rework: before! } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patches).toEqual([]);
  });

  test('routes 패치는 출발 노드의 목적지 전후값을 함께 남긴다', () => {
    const before = implement.edges.implement ?? [];
    const after = [...before, before[0]!];
    const result = applyOverlay(implement, { overlayId: 'route', routes: { implement: after } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patches).toEqual([{ overlayId: 'route', field: 'routes', node: 'implement', before, after }]);
  });

  test('없는 노드를 대면 거절한다 — 조용히 무시하지 않고 patches도 만들지 않는다', () => {
    const result = applyOverlay(research, { overlayId: 'bad', maxVisits: { nonexistent: 3 } });
    expect(result).toEqual({ ok: false, rejections: [{ kind: 'unknown-node', overlayId: 'bad', node: 'nonexistent', field: 'maxVisits' }] });
    expect('patches' in result).toBe(false);
  });

  test('없는 목적지로 라우트를 돌리면 거절한다', () => {
    const result = applyOverlay(research, { overlayId: 'bad2', routes: { judge: ['open-pr', 'nonexistent'] } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual([{ kind: 'unknown-destination', overlayId: 'bad2', from: 'judge', to: 'nonexistent' }]);
  });

  test('max_visits 0 은 거절한다 — 「한 번도 못 간다」는 노드를 남기지 않는다', () => {
    const result = applyOverlay(research, { overlayId: 'zero', maxVisits: { judge: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]).toEqual({ kind: 'non-positive-max-visits', overlayId: 'zero', node: 'judge', value: 0 });
  });

  test('⭐ RFC 의 「구조는 안 바뀐다」가 «절반만» 참임을 보인다 — 목적지만 돌려도 종료가 고립된다', () => {
    // 노드 «집합»은 그대로다. 그런데 착지(open-pr→merge)로 가는 유일한 길을 끊었다.
    const overlay: GraphOverlay = { overlayId: 'loop-forever', routes: { judge: ['investigate'] } };
    const result = applyOverlay(research, overlay);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [rejection] = result.rejections;
    expect(rejection.kind).toBe('breaks-graph');
    if (rejection.kind !== 'breaks-graph') return;
    expect(rejection.defects.some((d) => d.kind === 'unreachable-node' && d.node === 'merge')).toBe(true);
    expect(rejection.defects.some((d) => d.kind === 'unreachable-node' && d.node === 'open-pr')).toBe(true);
    expect(rejection.defects.some((d) => d.kind === 'inescapable-cycle')).toBe(true);
  });

  test('implement-loop 에도 같은 계약이 선다 — merge 로 가는 길을 끊으면 거절된다', () => {
    const withoutMerge = Object.fromEntries(
      Object.entries(implement.edges).map(([from, to]) => [from, to.filter((d) => d !== 'merge')]),
    );
    const result = applyOverlay(implement, { overlayId: 'no-merge', routes: withoutMerge });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.kind).toBe('breaks-graph');
  });

  test('값 없는 오버레이는 성공해도 빈 patches를 낸다', () => {
    const result = applyOverlay(research, { overlayId: 'empty' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patches).toEqual([]);
  });

  test('권위가 꺼지면 appliedPatches는 빈 배열이다', () => {
    const decision = decideTemplate({
      goalType: 'implement', authority: resolveGraphAuthority({ flag: false }), overlays: [], state: {}, stage: 'launch',
    });
    expect(decision.appliedPatches).toEqual([]);
  });

  test('여러 거절이 한꺼번에 모인다 — 첫 것만 내고 멈추지 않는다', () => {
    const result = applyOverlay(research, { overlayId: 'many', maxVisits: { nope: 2, judge: -1 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.kind).sort()).toEqual(['non-positive-max-visits', 'unknown-node']);
  });
});
