import { describe, expect, it } from 'bun:test';
import { observeFrontNodeEntry, type FrontNodeId } from '../src/self-dev/graph-front-nodes.js';
import { loadGraphTemplatesFrom, defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { templateHasNodeId, parseGraphTemplateYaml } from '../src/self-implement/graph-yaml.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ⭐ RFC §5 5단계 — 전반부 노드가 «선언»과 «관측»에 둘 다 있나.
 *  🩸 이 시험 전에는 `default-loop.yaml` 이 author/plan/decompose 를 선언만 하고 원장 표본이 0이었다. */
const specOf = (file: string) =>
  parseGraphTemplateYaml(readFileSync(join(defaultGraphsDir(), file), 'utf8'), file).template;

describe('전반부 노드 관측', () => {
  // ⛔ 판정 함수들은 «컴파일 전 spec» 을 받는다 — 컴파일된 템플릿을 넣으면 «런타임엔 통과하고»
  //   tsc 만 잡는다(실제로 그렇게 한 번 틀렸다).
  const template = specOf('default-loop.yaml');
  const compiled = loadGraphTemplatesFrom(defaultGraphsDir()).templates['default-loop'];

  it('셋이 «선언»에 있다 — 관측이 없는 노드를 부르면 원장이 거짓 신원을 단다', () => {
    expect(template).toBeDefined();
    expect(compiled).toBeDefined();
    // ⛔ 필드 이름을 지어내지 않는다 — 판정은 «이미 있는» 함수에 묻는다(`nodeId` ↔ `id` 오타로 위양성이 났었다).
    for (const node of ['author', 'plan', 'decompose']) expect(templateHasNodeId(template!, node)).toBe(true);
  });

  it('⛔ 관측은 fail-soft — 던지지 않는다(저작을 죽이면 안 된다)', () => {
    expect(() => observeFrontNodeEntry('author', { provenance: 'authoring-start' })).not.toThrow();
    expect(() => observeFrontNodeEntry('plan', {
      provenance: 'authoring-plan', goalId: 'g1', goalType: 'implement',
    })).not.toThrow();
    expect(() => observeFrontNodeEntry('decompose', {
      provenance: 'authoring-decomposition-start',
    })).not.toThrow();
  });

  it('⛔ 반증 — 그 판정 함수가 «없는» 이름엔 false 를 낸다(항상 true 를 내는 자가 아니다)', () => {
    expect(templateHasNodeId(template!, 'no-such-node')).toBe(false);
  });

  it('⛔ 반증 — 선언에 «없는» 노드 이름은 타입이 막는다(문자열 오타로 원장을 더럽히지 못한다)', () => {
    const accepts = (node: FrontNodeId): FrontNodeId => node;
    // @ts-expect-error 'implement' 는 후반부 노드다 — 전반부 관측에 넣을 수 없다
    accepts('implement');
    expect(accepts('author')).toBe('author');
  });
});

/** ⭐ 선언과 «실물»을 묶는다 — 격리 실측 `run-72915216` 이 저작 뒤 open questions 로 멎었고,
 *  `default-loop.yaml` 은 그 자리에 `arcs-with-open-questions: stopped` 를 «선언»하고 있었다.
 *  ⛔ 이 시험이 없으면 그 간선을 지워도 아무것도 안 문다(선언이 조용히 실물과 갈린다). */
describe('실물이 밟은 간선이 «선언»에 있다', () => {
  // ⛔ 결과 «라벨»은 컴파일된 템플릿에 «없다»(목적지 목록으로 접힌다) — 원 YAML 을 읽어야 답이 나온다.
  //   🪞 처음엔 `edgeMapOf(template).get(...)` 이라 썼다가 «두 번» 틀렸다(다른 타입 · 다른 반환).
  const spec = specOf('default-loop.yaml');

  it('plan 이 open questions 에서 갈 곳을 «선언»한다 — 실물이 그 간선을 밟았다', () => {
    const planEdge = spec!.edges.find((e) => e.from === 'plan');
    expect(planEdge?.map?.['arcs-with-open-questions']).toBe('stopped');
  });

  it('⛔ 반증 — 그 자가 «없는» 결과엔 목적지를 지어내지 않는다', () => {
    const planEdge = spec!.edges.find((e) => e.from === 'plan');
    expect(planEdge?.map?.['no-such-outcome']).toBeUndefined();
  });
});
