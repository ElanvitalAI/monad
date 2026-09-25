// ── splitPhaseIntoSubphases — 페이즈 국소 재분해(대표 2026-07-12) ──
// 큰 페이즈를 서브페이즈 선형 체인으로 쪼개고, 원본 dependsOn 승계 + dependents 재배선
// + 원본 제거를 검증(실행/LLM 은 주입으로 격리).
import { test, expect, describe } from 'bun:test';
import { splitPhaseIntoSubphases } from './mission-phase-split.js';
import { createMission } from './mission-registry.js';
import { createTask } from '../task-orchestrator/types.js';

const SUBS = JSON.stringify({
  rationale: '스키마 → pack 왕복 → write 배선 순으로 단일책임 분할.',
  tasks: [
    { index: 0, title: '스키마 마이그레이션', description: 'schema', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 's0' }, dependsOn: [], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['컬럼 추가'] } },
    { index: 1, title: 'pack 왕복 보존', description: 'pack', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 's1' }, dependsOn: [0], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['왕복 보존'] } },
    { index: 2, title: 'write 경로 배선', description: 'write', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 's2' }, dependsOn: [1], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['write 반영'] } },
  ],
});

async function setup() {
  const { TaskStore } = await import('../task-orchestrator/store.js');
  const store = new TaskStore({ path: ':memory:' });
  const m = createMission(store, { goal: 'KGS lifecycle 메타데이터', source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' } });
  const mk = (title: string, dependsOn: string[], now: number) => {
    const t = createTask({
      title, description: title,
      surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title },
      goalSlug: m.id, dependsOn, status: 'backlog',
      generatedBy: { kind: 'user', actorId: 'test' },
    }, { allowUncheckedUrgent: true, now });
    store.saveTask(t);
    return t;
  };
  const a = mk('조사', [], 1000);        // 선행
  const p = mk('KGS 큰 페이즈', [a.id], 1001); // 분할 대상
  const x = mk('후속(문서)', [p.id], 1002);    // dependent
  return { store, m, a, p, x };
}

describe('splitPhaseIntoSubphases', () => {
  test('큰 페이즈 → 서브페이즈 선형 체인·원본 dependsOn 승계·dependents 재배선·원본 제거', async () => {
    const { store, m, a, p, x } = await setup();
    let spawned = '';
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, {
        store, callable: async () => ({ text: SUBS, modelId: 'mock' }),
        spawnRun: (id) => { spawned = id; }, now: () => 5000,
      });
      expect(r.ok).toBe(true);
      expect(r.subPhaseCount).toBe(3);
      expect(r.subTitles).toEqual(['스키마 마이그레이션', 'pack 왕복 보존', 'write 경로 배선']); // 제목 열거(대표 2026-07-12)
      expect(spawned).toBe(m.id); // 재spawn(순회 재개)

      const phases = store.listTasks({ goalSlug: m.id }).filter((t) => t.surface.kind === 'subagent').sort((x, y) => x.createdAt - y.createdAt);
      // 원본 P 제거됨
      expect(phases.find((t) => t.id === p.id)).toBeUndefined();
      const subs = phases.filter((t) => r.subTaskIds.includes(t.id)).sort((x, y) => x.createdAt - y.createdAt);
      expect(subs.length).toBe(3);
      // sub[0] 은 원본 P 의 dependsOn(=조사 a) 승계
      expect(subs[0]!.dependsOn).toContain(a.id);
      expect(subs[0]!.dependsOn).not.toContain(p.id);
      // 선형 체인
      expect(subs[1]!.dependsOn).toEqual([subs[0]!.id]);
      expect(subs[2]!.dependsOn).toEqual([subs[1]!.id]);
      // dependent X 는 이제 마지막 서브에 의존(P 참조 제거)
      const xNow = store.listTasks({ goalSlug: m.id }).find((t) => t.id === x.id)!;
      expect(xNow.dependsOn).toContain(subs[2]!.id);
      expect(xNow.dependsOn).not.toContain(p.id);

      // ★ 넘버링 정합(대표 2026-07-12) — 서브가 원본 createdAt 슬롯(C)을 점유, 뒤 페이즈는 N-1 밀림.
      expect(subs[0]!.createdAt).toBe(p.createdAt);              // 원본 슬롯 점유(C)
      expect(xNow.createdAt).toBe(x.createdAt + (3 - 1));        // dependent 는 N-1(=2) 밀림
      // 표시 순서(createdAt 정렬) = 실행 순서: [조사, sub0, sub1, sub2, 후속]
      const order = phases.map((t) => t.title);
      expect(order).toEqual(['조사', subs[0]!.title, subs[1]!.title, subs[2]!.title, '후속(문서)']);
    } finally { store.close(); }
  });

  test('★ P4 — 승인된(active) 미션 split 은 서브페이즈를 blocked 로 생성(approve 재무장 차단)', async () => {
    const { store, m, p } = await setup();
    store.saveMission({ ...store.getMission(m.id)!, status: 'active' }); // 승인=running
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, { store, callable: async () => ({ text: SUBS, modelId: 'mock' }), spawnRun: () => {}, now: () => 5000 });
      expect(r.ok).toBe(true);
      const subs = store.listTasks({ goalSlug: m.id }).filter((t) => r.subTaskIds.includes(t.id));
      expect(subs.length).toBe(3);
      // 승인 범위 내 — backlog(승인대기 신호) 아님. executor promote()가 blocked→ready 승격(실행 무회귀).
      expect(subs.every((t) => t.status === 'blocked')).toBe(true);
      expect(subs.some((t) => t.status === 'backlog')).toBe(false);
    } finally { store.close(); }
  });

  test('★ P4 — 미승인(default) 미션 split 은 서브페이즈를 backlog 로 유지(정상 승인 흐름)', async () => {
    const { store, m, p } = await setup(); // createMission 기본 상태(미승인·active 아님)
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, { store, callable: async () => ({ text: SUBS, modelId: 'mock' }), spawnRun: () => {}, now: () => 5000 });
      expect(r.ok).toBe(true);
      const subs = store.listTasks({ goalSlug: m.id }).filter((t) => r.subTaskIds.includes(t.id));
      expect(subs.every((t) => t.status === 'backlog')).toBe(true);
    } finally { store.close(); }
  });

  test('★ Device 1 cap-hit — 예산 도달 시 split 차단·원본 보존·decompose 미호출', async () => {
    const { store, m, p } = await setup(); // 3 페이즈(a, p, x)
    // 1 아크 → budget = 1×5 = 5. 페이즈 2개 더 추가해 정확히 예산(5) 도달.
    store.saveMission({ ...store.getMission(m.id)!, autopilot: { origin: 'manual', arcs: [{ arcId: 'arc0', phaseIds: [p.id], splitCount: 0 }] } as any });
    const mk = (title: string, now: number) => {
      const t = createTask({ title, description: title, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: title }, goalSlug: m.id, dependsOn: [], status: 'backlog', generatedBy: { kind: 'user', actorId: 'test' } }, { allowUncheckedUrgent: true, now });
      store.saveTask(t); return t;
    };
    mk('filler1', 2000); mk('filler2', 2001); // 총 5 페이즈 = budget
    let called = false;
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, {
        store, callable: async () => { called = true; return { text: SUBS, modelId: 'mock' }; },
        spawnRun: () => {}, now: () => 5000,
      });
      expect(r.ok).toBe(false);
      expect(r.capHit).toBe(true);
      expect(r.error).toContain('예산 초과');
      expect(called).toBe(false); // decompose(LLM) 아예 호출 안 됨 — 예산 검사가 먼저 차단
      // 원본 P 보존(제거 안 함)
      expect(store.listTasks({ goalSlug: m.id }).find((t) => t.id === p.id)).toBeDefined();
    } finally { store.close(); }
  });

  test('★ Device 1 — 예산 여유 있으면 정상 split(회귀 가드)', async () => {
    const { store, m, p } = await setup(); // 3 페이즈·아크 없음 → budget=floor=8·여유 충분
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, { store, callable: async () => ({ text: SUBS, modelId: 'mock' }), spawnRun: () => {}, now: () => 5000 });
      expect(r.ok).toBe(true);
      expect(r.capHit).toBeUndefined();
      expect(r.subPhaseCount).toBe(3);
    } finally { store.close(); }
  });

  test('없는 페이즈 → ok:false(에러)', async () => {
    const { store, m } = await setup();
    try {
      const r = await splitPhaseIntoSubphases(m.id, 'task:nope', { store, callable: async () => ({ text: SUBS, modelId: 'mock' }), spawnRun: () => {} });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('페이즈 없음');
    } finally { store.close(); }
  });

  test('1개 이하로 분해되면 ok:false(분할 불가·원본 보존)', async () => {
    const { store, m, p } = await setup();
    const ONE = JSON.stringify({ rationale: 'x', tasks: [{ index: 0, title: '단일', description: 'd', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 'p' }, dependsOn: [], priority: 'high', estimateMs: 1, estimateTokens: 1, estimateUsd: 0.1, acceptance: { criteria: ['c'] } }] });
    try {
      const r = await splitPhaseIntoSubphases(m.id, p.id, { store, callable: async () => ({ text: ONE, modelId: 'mock' }), spawnRun: () => {} });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('분할 불가');
      // 원본 P 보존(제거 안 함)
      expect(store.listTasks({ goalSlug: m.id }).find((t) => t.id === p.id)).toBeDefined();
    } finally { store.close(); }
  });
});
