// ── se-build-registry — SE 빌드 레지스트리(대표 2026-07-13·PLAN B0) ──
import { describe, it, expect } from 'bun:test';
import {
  makeBuildId, buildLogPath, openSeBuildsDb, upsertBuild, getBuild, listBuilds, nextAttemptSeq, markBuildStatus,
} from './se-build-registry.js';

const NOW = '2026-07-13T09:00:00.000Z';
function base(over: Record<string, unknown> = {}) {
  return {
    buildId: 'bld_0808d01f_1', missionId: 'apm_x', phaseId: 'task:0808d01f', phaseTitle: 'P4 실행기',
    index: 4, total: 7, attemptSeq: 1, backend: 'monad-self:gpt-5.6-terra',
    status: 'running' as const, now: () => NOW, ...over,
  };
}

describe('makeBuildId — 재시도별 결정론', () => {
  it('bld_<phaseHex8>_<attempt>', () => {
    expect(makeBuildId('task:0808d01fabcd', 1)).toBe('bld_0808d01f_1');
    expect(makeBuildId('task:0808d01fabcd', 3)).toBe('bld_0808d01f_3'); // 재시도=다른 ID
  });
  it('task: 접두 없어도·비hex 방어', () => {
    expect(makeBuildId('0808d01f', 2)).toBe('bld_0808d01f_2');
    expect(makeBuildId('', 1)).toBe('bld_unknown_1');
  });
  it('buildLogPath = builds/<id>.log', () => {
    expect(buildLogPath('bld_0808d01f_1')).toContain('/conatus/builds/bld_0808d01f_1.log');
  });
});

describe('레지스트리 CRUD + 상태 전이', () => {
  it('upsert(running) → get', () => {
    const db = openSeBuildsDb(':memory:');
    upsertBuild(db, base({ worktree: '/wt/se-x', branch: 'se/x' }));
    const b = getBuild(db, 'bld_0808d01f_1');
    expect(b?.status).toBe('running');
    expect(b?.worktree).toBe('/wt/se-x');
    expect(b?.startedAt).toBe(NOW);
    expect(b?.endedAt).toBeNull();
    expect(b?.logPath).toContain('bld_0808d01f_1.log');
    db.close();
  });

  it('종결 upsert(gate-failed) → startedAt 보존·endedAt 세팅', () => {
    const db = openSeBuildsDb(':memory:');
    upsertBuild(db, base({ now: () => NOW }));
    upsertBuild(db, base({ status: 'gate-failed', gateResult: 'critique fail', now: () => '2026-07-13T09:05:00.000Z' }));
    const b = getBuild(db, 'bld_0808d01f_1')!;
    expect(b.status).toBe('gate-failed');
    expect(b.startedAt).toBe(NOW);                       // 시작시각 보존
    expect(b.endedAt).toBe('2026-07-13T09:05:00.000Z');  // 종결시각 세팅
    expect(b.gateResult).toBe('critique fail');
    db.close();
  });

  it('listBuilds — 기본 running 만, all 이면 전체·missionId 필터', () => {
    const db = openSeBuildsDb(':memory:');
    upsertBuild(db, base({ buildId: 'bld_a_1', phaseId: 'task:a', status: 'running' }));
    upsertBuild(db, base({ buildId: 'bld_b_1', phaseId: 'task:b', status: 'built' }));
    upsertBuild(db, base({ buildId: 'bld_c_1', phaseId: 'task:c', missionId: 'apm_other', status: 'running' }));
    expect(listBuilds(db).length).toBe(2);                          // running 2
    expect(listBuilds(db, { all: true }).length).toBe(3);          // 전체
    expect(listBuilds(db, { missionId: 'apm_x', all: true }).length).toBe(2);
    db.close();
  });

  it('markBuildStatus — 중단(aborted) 마킹·endedAt 세팅·미존재 false', () => {
    const db = openSeBuildsDb(':memory:');
    upsertBuild(db, base({ buildId: 'bld_s_1', status: 'running', now: () => NOW }));
    const ok = markBuildStatus(db, 'bld_s_1', 'aborted', () => '2026-07-13T09:10:00.000Z');
    expect(ok).toBe(true);
    const b = getBuild(db, 'bld_s_1')!;
    expect(b.status).toBe('aborted');
    expect(b.endedAt).toBe('2026-07-13T09:10:00.000Z');
    expect(markBuildStatus(db, 'bld_nope', 'aborted')).toBe(false); // 미존재
    db.close();
  });

  it('nextAttemptSeq — 페이즈 빌드 수 +1 (재시도 ID 부여)', () => {
    const db = openSeBuildsDb(':memory:');
    expect(nextAttemptSeq(db, 'task:0808d01f')).toBe(1);
    upsertBuild(db, base({ buildId: 'bld_0808d01f_1', attemptSeq: 1 }));
    expect(nextAttemptSeq(db, 'task:0808d01f')).toBe(2);
    upsertBuild(db, base({ buildId: 'bld_0808d01f_2', attemptSeq: 2, backend: 'opus-4.8' }));
    expect(nextAttemptSeq(db, 'task:0808d01f')).toBe(3);            // 다음=opus 폴백 등
    db.close();
  });
});
