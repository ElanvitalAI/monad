// 걷는 규칙 «한 벌» — 걷는 자(walker)를 주입해 규칙만 문다(바깥 워커 없이 돈다).
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { inkRulerAny } from './recipes/character.js';
import { HYPERFRAMES } from './recipes/hyperframes.js';
import { UNOBSERVED, type Recipe } from './recipes/types.js';
import { ALL_RECIPES, exitCodeOf, findTemplate, loadWalker, walkLine, type GraphSpecLike, type WalkerApi } from './walk-line.js';

/** 최소 걷는 자 — 간선 map 을 따라가고, null 이면 unobservedNode 로, 받는 간선이 없으면 no-edge 로 멎는다. */
const fakeWalker: WalkerApi = {
  readGraphSpec: () => ({ error: 'unused' }),
  async walkGraph(spec, step, opts) {
    const terminals = new Set(['delivered', 'unobserved', 'failed']);
    const steps: { node: string; visit: number }[] = [];
    const visits: Record<string, number> = {};
    let cur: string | null = spec.nodes[0]!.node_id;
    while (cur && steps.length < opts.maxSteps) {
      visits[cur] = (visits[cur] ?? 0) + 1;
      steps.push({ node: cur, visit: visits[cur]! });
      if (terminals.has(cur)) return { terminal: cur, stopReason: 'terminal', steps };
      const node = spec.nodes.find((n) => n.node_id === cur)!;
      const out = await step(node);
      if (out === null) { cur = opts.unobservedNode; continue; }
      const e = spec.edges.find((x) => x.from === cur && (x.to !== undefined || (x.map !== undefined && out in x.map)));
      if (!e) return { terminal: null, stopReason: 'no-edge', steps };
      cur = e.to ?? e.map![out]!;
    }
    return { terminal: null, stopReason: 'budget-exceeded', steps };
  },
};

const spec: GraphSpecLike = {
  graph_id: 't',
  nodes: [{ node_id: 'a', recipe: 'r-a' }, { node_id: 'b', recipe: 'r-b' }, { node_id: 'delivered' }, { node_id: 'unobserved' }],
  edges: [{ from: 'a', map: { ok: 'b' } }, { from: 'b', map: { ok: 'delivered' } }],
};
const ok = (produced?: Record<string, unknown>): Recipe => async () => ({ outcome: 'ok', produced });

describe('walkLine — 걷는 규칙', () => {
  it('✅ 산출이 state 에 합쳐지고 delivered 에 닿는다', async () => {
    const state: Record<string, unknown> = {};
    const r = await walkLine({ spec, walker: fakeWalker, state, workdir: '/tmp', recipes: { 'r-a': ok({ x: 1 }), 'r-b': ok() } });
    expect(r.terminal).toBe('delivered');
    expect(r.path).toBe('a→b→delivered');
    expect(state.x).toBe(1);
    expect(r.trace.map((t) => t.outcome)).toEqual(['ok', 'ok']);
  });
  it('⛔ 받는 간선이 없는 「못 쟀다」는 no-edge 가 아니라 unobserved 로 간다', async () => {
    const unm: Recipe = async () => ({ outcome: UNOBSERVED });
    const r = await walkLine({ spec, walker: fakeWalker, state: {}, workdir: '/tmp', recipes: { 'r-a': unm, 'r-b': ok() } });
    expect(r.terminal).toBe('unobserved');
    expect(r.stopReason).not.toBe('no-edge');
  });
  it('⛔ 구현이 없는 레시피는 이름을 댄다(조용히 통과하지 않는다)', async () => {
    const r = await walkLine({ spec, walker: fakeWalker, state: {}, workdir: '/tmp', recipes: { 'r-a': ok() } });
    expect(r.unknownRecipe).toBe('b(r-b)');
    expect(r.terminal).toBe('unobserved');
  });
});

describe('레시피 표 «하나»', () => {
  it('⭐ 겹치는 이름 ink-ruler 는 두 계약을 다 받는 쪽이 이긴다', () => {
    expect(ALL_RECIPES['ink-ruler']).toBe(inkRulerAny);
  });
  it('hyperframes-render 는 HYPERFRAMES 맵으로 등록되고 기존 키를 덮지 않는다', () => {
    expect(ALL_RECIPES['hyperframes-render']).toBe(HYPERFRAMES['hyperframes-render']);
    expect(Object.keys(HYPERFRAMES)).toEqual(['hyperframes-render', 'storyboard-gate']);
  });
  it('graph_id 로 선언을 찾는다 — 파일 이름이 달라도(vlog 는 .declaration 이 붙는다)', () => {
    const dir = join(import.meta.dir, '../../graphs/video');
    expect(findTemplate('vlog-found-footage-pipeline', dir)).toEndWith('vlog-found-footage-pipeline.declaration.yaml');
    expect(findTemplate('character-video-standard', dir)).toEndWith('character-video-standard.yaml');
    expect(findTemplate('no-such-graph', dir)).toBeNull();
  });
  it('종료 코드 — 0 delivered · 2 못 쟀다 · 1 그 밖', () => {
    expect([exitCodeOf('delivered'), exitCodeOf('unobserved'), exitCodeOf('master-only'), exitCodeOf(null)]).toEqual([0, 2, 1, 1]);
  });
});

// 🩸 2026-09-23 실물 결함 — video-free-line 의 복사본은 「못 쟀다」를 날것으로 넘겼고,
//   그것을 받는 간선이 없는 overlay(draw-captions · 「한글 폰트 없음」)에서 걷는 자가 no-edge 로 죽었다.
//   ⛔ 진짜 선언 ⊕ 진짜 걷는 자로 문다(걷는 자가 없으면 «건너뛴다고 말한다»).
const REAL_WALKER = `${process.env.HOME}/temp/agentic-consulting/scripts/graph-walk.ts`;
const HAS_WALKER = (await import('node:fs')).existsSync(REAL_WALKER);
if (!HAS_WALKER) console.warn(`➖ 걷는 자 없음(${REAL_WALKER}) — video-production 실선언 시험을 «못 돌렸다»`);
describe.skipIf(!HAS_WALKER)('video-production 실선언 — 간선 없는 노드의 「못 쟀다」', () => {
  it('overlay 가 unmeasurable 이면 no-edge 가 아니라 unobserved 에 닿는다', async () => {
    const w = (await loadWalker(REAL_WALKER))!;
    const { spec: real } = w.readGraphSpec(join(import.meta.dir, '../../graphs/video/video-production-pipeline.declaration.yaml'));
    const first = (id: string): string => Object.keys(real!.edges.find((e) => e.from === id)?.map ?? { ok: '' })[0]!;
    const recipes = Object.fromEntries(real!.nodes.filter((n) => n.recipe).map((n) => [n.recipe!,
      (async () => ({ outcome: n.node_id === 'overlay' ? UNOBSERVED : first(n.node_id) })) as Recipe]));
    const r = await walkLine({ spec: real!, walker: w, state: {}, workdir: '/tmp', recipes });
    expect(r.stopReason).not.toBe('no-edge');
    expect(r.terminal).toBe('unobserved');
    expect(r.path).toEndWith('overlay→unobserved');
  });
});
