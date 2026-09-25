// Intent Gate submitIntent 검증 — 마커→Mission(planning) 생성·passthrough.
import { describe, it, expect } from 'bun:test';
import { TaskStore } from '../task-orchestrator/store.js';
import { isAutopilotMission } from '../task-orchestrator/mission-autopilot.js';
import { submitIntent, type SubmitIntentInput } from './gate.js';

// LLM(luna) title 생성 우회 — 테스트는 stub slug 주입(결정론·네트워크 무의존·seam).
const stubSlug = async () => 'test-title';
const sub = (o: SubmitIntentInput) => submitIntent({ slugFn: stubSlug, ...o });

function memStore(): TaskStore {
  return new TaskStore({ path: ':memory:' });
}

describe('submitIntent', async () => {
  it('마커 없으면 passthrough(미션 미생성)', async () => {
    const store = memStore();
    try {
      const r = await sub({ text: '지금 삼성 얼마야?', channel: 'telegram', store });
      expect(r.route).toBe('passthrough');
      expect(store.listMissions().length).toBe(0);
    } finally { store.close(); }
  });

  it('마커면 Mission(planning) 생성 + 실행모델 부착', async () => {
    const store = memStore();
    try {
      const r = await sub({ text: '미션: 매일 아침 반도체 뉴스 정리', channel: 'telegram', store, now: new Date('2026-07-09T00:00:00Z') });
      expect(r.route).toBe('mission');
      if (r.route !== 'mission') return;
      expect(r.goal).toBe('매일 아침 반도체 뉴스 정리');
      expect(r.executionModel.length).toBeGreaterThan(0);

      const missions = store.listMissions();
      expect(missions.length).toBe(1);
      const m = missions[0]!;
      expect(m.id).toBe(r.missionId);
      // 미션은 planning(승인 전 실행 안 함)·autopilot 메타 보유.
      expect(m.status).toBe('planning');
      expect(isAutopilotMission(m)).toBe(true);

      // V4 — 자동 분해로 backlog 태스크가 생겼다(실행 안 함).
      expect(r.taskId).toBeTruthy();
      const tasks = store.listTasks({ goalSlug: m.id });
      expect(tasks.length).toBe(1);
      expect(tasks[0]!.status).toBe('backlog');
      // scheduler 골이면 cron 추천이 붙는다.
      expect(r.inferredCron).toBeTruthy();
    } finally { store.close(); }
  });

  it('여러 문장 골 보존', async () => {
    const store = memStore();
    try {
      const r = await sub({ text: '이건 미션이야: 삼성 급락 감시. 급락하면 매매 검토.', channel: 'telegram', store });
      if (r.route !== 'mission') throw new Error('expected mission');
      expect(r.goal).toBe('삼성 급락 감시. 급락하면 매매 검토.');
    } finally { store.close(); }
  });

  // ★ 크기적응 준비 + HITL(대표 지시 2026-07-11) — human-intent 미션은 외부조사 보강 + 크기적응
  //   분해를 detached prepare 로 트리거하고, 자동 승인 없음(수렴점=사람 확인). heavy 는 특히 항상 게이팅.
  it('heavy human-intent → prepare 트리거·자동승인 없음(HITL)', async () => {
    const store = memStore();
    const spawned: string[] = [];
    try {
      const r = await sub({
        text: '미션: persistence 마이그레이션 전면 리팩토링',   // 마이그레이션/리팩토링 = heavy
        channel: 'pwa', source: 'human-intent', store,
        spawnPrepare: (id) => spawned.push(id),
      });
      if (r.route !== 'mission') throw new Error('expected mission');
      expect(r.heavy).toBe(true);
      expect(r.needsPhaseReview).toBe(true);
      expect(r.needsResearchGate).toBe(true);
      expect(r.autoApproved).toBeFalsy();      // 자동 실행 안 함
      expect(r.taskId).toBeFalsy();            // heavy 는 즉시 단일 태스크 생성 안 함(분해는 prepare)
      expect(spawned).toEqual([r.missionId]);  // prepare seam 호출됨
      expect(store.listMissions()[0]!.status).toBe('planning');   // 승인 전 실행 0
    } finally { store.close(); }
  });

  it('light human-intent → prepare(외부조사 게이트) 트리거·자동승인 없음', async () => {
    const store = memStore();
    const spawned: string[] = [];
    try {
      const r = await sub({
        text: '미션: 반도체 뉴스 정리',   // 짧은 단문 = light
        channel: 'pwa', source: 'human-intent', store,
        spawnPrepare: (id) => spawned.push(id),
      });
      if (r.route !== 'mission') throw new Error('expected mission');
      expect(r.heavy).toBeFalsy();
      expect(r.needsResearchGate).toBe(true);  // 작은 미션도 외부조사 게이트
      expect(r.autoApproved).toBeFalsy();      // 자동 승인 없음(clean→바로승인 구조 아님)
      expect(r.taskId).toBeTruthy();           // 빠른 응답용 placeholder 태스크
      expect(spawned).toEqual([r.missionId]);  // prepare seam 호출됨
      expect(store.listMissions()[0]!.status).toBe('planning');
    } finally { store.close(); }
  });

  it('분해 검증 마커 → 작은 골이라도 강제 분해(forceDecompose·verifyDecompose)', async () => {
    const store = memStore();
    const calls: Array<{ id: string; force?: boolean }> = [];
    try {
      const r = await sub({
        text: '미션 분해 검증: ops 출력에 상대시간 표시',   // 작은 골(light) 이지만 강제 분해
        channel: 'pwa', source: 'human-intent', store,
        spawnPrepare: (id, opts) => calls.push({ id, force: opts?.forceDecompose }),
      });
      if (r.route !== 'mission') throw new Error('expected mission');
      expect(r.heavy).toBe(true);              // forceDecompose → heavy 취급
      expect(r.verifyDecompose).toBe(true);
      expect(r.needsPhaseReview).toBe(true);
      expect(r.taskId).toBeFalsy();            // heavy 경로 — placeholder 없음
      expect(calls).toEqual([{ id: r.missionId, force: true }]);   // prepare 에 force 전달
      expect(store.listMissions()[0]!.status).toBe('planning');
    } finally { store.close(); }
  });

  it('discovery 미션은 proposed(prepare 트리거 안 함)', async () => {
    const store = memStore();
    const spawned: string[] = [];
    try {
      const r = await sub({
        text: '미션: 반도체 뉴스 정리', channel: 'pwa', source: 'discovery', store,
        spawnPrepare: (id) => spawned.push(id),
      });
      if (r.route !== 'mission') throw new Error('expected mission');
      expect(spawned.length).toBe(0);   // 자율 미션은 prepare 트리거 안 함(proposed 유지)
      expect(r.taskId).toBeTruthy();    // 기존 단일 backlog 태스크
      expect((r as { needsResearchGate?: boolean }).needsResearchGate).toBeFalsy();
    } finally { store.close(); }
  });
});

import { shouldPhaseDecompose } from '../autopilot/mission-engine.js';
describe('shouldPhaseDecompose', () => {
  it('heavy → true, light/null → false', () => {
    expect(shouldPhaseDecompose({ tier: 'heavy' })).toBe(true);
    expect(shouldPhaseDecompose({ tier: 'light' })).toBe(false);
    expect(shouldPhaseDecompose({ tier: null })).toBe(false);
  });
});
