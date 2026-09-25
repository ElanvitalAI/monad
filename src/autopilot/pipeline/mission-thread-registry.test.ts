// 미션 thread 레지스트리(UR4a) — disk-discovery thread authority 검증 (2026-07-19)
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFrameDir } from './frame-journal.js';
import { recordExecPhase } from './exec-frame-journal.js';
import { listMissionThreads, activeThreadCount, sweepMissionThreads, governMissionThreads } from './mission-thread-registry.js';
import { persistMissionState } from './mission-state-assemble.js';
import { applyChannelUpdates, cursorUpdate } from './mission-state-channels.js';

describe('mission-thread-registry — disk-discovery thread authority', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'threadreg-')); setFrameDir(dir); });
  afterEach(() => { setFrameDir(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('exec 저널 있는 미션들을 enumerate + 요약', () => {
    recordExecPhase('apm_alpha_1', { phaseId: 'p1', phaseTitle: '조사 A', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_alpha_1', { phaseId: 'p1', phaseTitle: '조사 A', op: 'phase-done', status: 'done' });
    recordExecPhase('apm_beta_2', { phaseId: 'q1', phaseTitle: '구현 B', op: 'phase-start', status: 'running' });
    const rows = listMissionThreads();
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.missionId).sort();
    expect(ids).toEqual(['apm_alpha_1', 'apm_beta_2']);
    // 실 missionId 를 프레임에서 복원(safeId 파일명 아님)
    const alpha = rows.find((r) => r.missionId === 'apm_alpha_1')!;
    expect(alpha.summary.execFrames).toBe(2);
    expect(alpha.active).toBe(true); // 방금 만든 저널 → 활성
  });

  test('activeThreadCount — 활성 thread 수', () => {
    recordExecPhase('apm_x_1', { phaseId: 'p', phaseTitle: 'X', op: 'phase-start', status: 'running' });
    expect(activeThreadCount()).toBe(1);
  });

  test('activeWithinMin — 넉넉한 시간창이면 방금 저널은 active', () => {
    recordExecPhase('apm_y_1', { phaseId: 'p', phaseTitle: 'Y', op: 'phase-start', status: 'running' });
    const rows = listMissionThreads({ activeWithinMin: 100000 });
    expect(rows.length).toBe(1);
    expect(rows[0]!.active).toBe(true);   // 방금 만든 저널은 시간창 안
  });

  test('저널 없으면 빈 목록(비파괴·회귀0)', () => {
    expect(listMissionThreads()).toEqual([]);
  });

  test('sweepMissionThreads — 스톨(replan)·pending cursor 감지(데몬 상주 인지)', () => {
    recordExecPhase('apm_stall_1', { phaseId: 'p', phaseTitle: 'X', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_stall_1', { phaseId: 'p', phaseTitle: 'X', op: 'phase-done', status: 'failed' });
    // 중앙 State: progress=replan(스톨) + 재개 커서(pending goto)
    persistMissionState('apm_stall_1', applyChannelUpdates({}, [
      { channel: 'progress', value: { recommendation: 'replan' } },
      cursorUpdate({ phaseId: 'p' }),
    ]));
    // 정상 thread(스톨 아님)
    recordExecPhase('apm_ok_2', { phaseId: 'q', phaseTitle: 'Y', op: 'phase-start', status: 'running' });
    const s = sweepMissionThreads();
    expect(s.activeCount).toBe(2);
    expect(s.stalledCount).toBe(1);
    expect(s.stalled).toContain('apm_stall_1');
    expect(s.pendingCursorCount).toBe(1);
    expect(s.pendingCursor).toContain('apm_stall_1');
  });

  test('sweep liveness — 실행중(비-최종)인데 저널 stale = stuck/dead 감지(heartbeat)', () => {
    // 실행중(phase-start 후 미종결) thread. 방금 만들어 age~0 이니 staleMinutes=0 으로 stuck 판정.
    recordExecPhase('apm_stuck_1', { phaseId: 'p', phaseTitle: 'running', op: 'phase-start', status: 'running' });
    // 정상 완료 thread(실행중 아님 → stuck 아님)
    recordExecPhase('apm_done_2', { phaseId: 'q', phaseTitle: 'ok', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_done_2', { phaseId: 'q', phaseTitle: 'ok', op: 'phase-done', status: 'done' });
    const s = sweepMissionThreads({ staleMinutes: 0 });
    expect(s.stuckCount).toBe(1);
    expect(s.stuck).toContain('apm_stuck_1');   // 실행중 + stale
    expect(s.stuck).not.toContain('apm_done_2'); // 완료 = 실행중 아님 → stuck 아님
  });

  test('governMissionThreads — stuck/pending-goto 를 재spawn(능동 수복·UR4c)', () => {
    // stuck: 실행중 + 저널 stale
    recordExecPhase('apm_g_stuck', { phaseId: 'p', phaseTitle: 'running', op: 'phase-start', status: 'running' });
    // pending-goto: 완료 thread지만 cursor 남음
    recordExecPhase('apm_g_goto', { phaseId: 'q', phaseTitle: 'done', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_g_goto', { phaseId: 'q', phaseTitle: 'done', op: 'phase-done', status: 'done' });
    persistMissionState('apm_g_goto', applyChannelUpdates({}, [cursorUpdate({ phaseId: 'q' })]));
    // 정상 thread(수복 대상 아님)
    recordExecPhase('apm_g_ok', { phaseId: 'r', phaseTitle: 'ok', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_g_ok', { phaseId: 'r', phaseTitle: 'ok', op: 'phase-done', status: 'done' });

    const spawned: string[] = [];
    const g = governMissionThreads({ spawnRun: (id) => spawned.push(id), staleMinutes: 0 });
    // stuck + pending-goto 둘 다 재spawn 트리거, 정상은 아님
    expect(spawned.sort()).toEqual(['apm_g_goto', 'apm_g_stuck']);
    expect(g.resumed.sort()).toEqual(['apm_g_goto', 'apm_g_stuck']);
    expect(spawned).not.toContain('apm_g_ok');
  });

  test('governMissionThreads — 수복 대상 없으면 spawn 0(비파괴·회귀0)', () => {
    recordExecPhase('apm_clean', { phaseId: 'p', phaseTitle: 'ok', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_clean', { phaseId: 'p', phaseTitle: 'ok', op: 'phase-done', status: 'done' });
    const spawned: string[] = [];
    governMissionThreads({ spawnRun: (id) => spawned.push(id) }); // staleMinutes 기본 30 → 방금 만든 건 stuck 아님
    expect(spawned).toEqual([]);
  });

  test('최근 활동 순 정렬(ageMinutes 오름차순)', () => {
    recordExecPhase('apm_old_1', { phaseId: 'p', phaseTitle: 'old', op: 'phase-start', status: 'running' });
    recordExecPhase('apm_new_2', { phaseId: 'p', phaseTitle: 'new', op: 'phase-start', status: 'running' });
    const rows = listMissionThreads();
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.ageMinutes).toBeGreaterThanOrEqual(rows[i - 1]!.ageMinutes);
  });
});
