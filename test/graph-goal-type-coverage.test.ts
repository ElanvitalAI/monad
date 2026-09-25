import { expect, test } from 'bun:test';
import { GOAL_TYPES } from '../src/self-implement/goal-author.js';
import {
  defaultGraphsDir,
  goalTypesWithoutTemplate,
  GRAPH_TEMPLATES,
  GRAPH_TEMPLATES_SOURCE,
  inspectAllTemplates,
  loadGraphTemplatesFrom,
  templateForGoalType,
} from '../src/self-implement/graph-templates.js';

// ⛔⭐ 이 시험은 템플릿의 «개수»를 박지 않는다 — 곧 다른 골이 graphs/ 에 파일을 더 놓는다.
//   수를 박으면 그때 main 이 «이 시험 때문에» 깨진다. 판정은 「필요한 것이 있나」로 한다.

test('골 종류 «넷»이 전부 그래프를 갖는다 — 빠진 종류는 구현 루프로 «접힌다»', () => {
  expect([...goalTypesWithoutTemplate()]).toEqual([]);
  for (const goalType of GOAL_TYPES) {
    const template = templateForGoalType(goalType);
    if (!template) throw new Error(`${goalType} 에 템플릿이 없다`);
    expect(template.nodes.length).toBeGreaterThan(0);
  }
});

test('네 종류가 «서로 다른» 그래프를 쓴다 — 이름이 같으면 원장에서 못 가른다', () => {
  const ids = GOAL_TYPES.map((g) => templateForGoalType(g)?.graphId);
  expect(new Set(ids).size).toBe(GOAL_TYPES.length);
});

test('document·operate 가 구현 루프의 «복사본»이 아니다', () => {
  const impl = new Set((templateForGoalType('implement')?.nodes ?? []).map((n) => n.nodeId));
  for (const goalType of ['document', 'operate'] as const) {
    const nodes = new Set((templateForGoalType(goalType)?.nodes ?? []).map((n) => n.nodeId));
    expect(nodes.size).toBeGreaterThan(0);
    // ⛔ 노드 이름 집합이 «같으면» 이름만 바꾼 것이다
    const same = nodes.size === impl.size && [...nodes].every((n) => impl.has(n));
    expect(same).toBe(false);
  }
});

test('선언이 «전부» 읽히고 document·operate resolver는 YAML 적재 템플릿을 그대로 돌려준다', () => {
  const loaded = loadGraphTemplatesFrom(defaultGraphsDir());
  expect(GRAPH_TEMPLATES_SOURCE).toBe('yaml');
  expect(loaded.source).toBe('yaml');
  for (const graphId of ['self-implement', 'research-loop', 'document-loop', 'operate-loop']) {
    expect(Object.keys(loaded.templates)).toContain(graphId);
  }
  expect(templateForGoalType('document')).toBe(GRAPH_TEMPLATES['document-loop']);
  expect(templateForGoalType('operate')).toBe(GRAPH_TEMPLATES['operate-loop']);
});

test('네 goal template의 inspectAllTemplates 결과는 위상 결함이 0 이다', () => {
  const goalTemplateIds = new Set(GOAL_TYPES.map((goalType) => templateForGoalType(goalType)?.graphId));
  const inspected = inspectAllTemplates().filter(({ graphId }) => goalTemplateIds.has(graphId));
  expect(inspected).toHaveLength(GOAL_TYPES.length);
  expect(inspected).toEqual(inspected.map(({ graphId }) => ({ graphId, defects: [] })));
});
