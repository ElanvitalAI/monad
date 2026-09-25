import { describe, test, expect } from 'bun:test';
import { stopMissionExecutor, executorProcessPattern } from './mission-executor-control.js';

describe('executorProcessPattern — run-mission·se-mission-prepare 둘 다(2026-07-18 좀비 분해 수복)', () => {
  test('패턴이 run-mission·se-mission-prepare·missionId 를 모두 포함', () => {
    const p = executorProcessPattern('apm_x');
    expect(p).toContain('run-mission');
    expect(p).toContain('se-mission-prepare');
    expect(p).toContain('apm_x');
  });
});

describe('stopMissionExecutor — cancel이 executor 종료(대표 2026-07-16 좀비 빌드 수복)', () => {
  test('찾은 pid 를 그룹 kill 하고 종료 목록 반환', () => {
    const killed: number[] = [];
    const result = stopMissionExecutor('apm_x', {
      findPids: () => [111, 222],
      killGroup: (pid) => killed.push(pid),
    });
    expect(result).toEqual([111, 222]);
    expect(killed).toEqual([111, 222]); // 실제로 kill 호출됨(seam)
  });

  test('자기 자신(process.pid)은 건너뜀 — cancel 프로세스 자기 종료 방지', () => {
    const killed: number[] = [];
    const result = stopMissionExecutor('apm_x', {
      findPids: () => [process.pid, 333],
      killGroup: (pid) => killed.push(pid),
    });
    expect(result).toEqual([333]);
    expect(killed).toEqual([333]);
  });

  test('매칭 executor 없으면 빈 목록(no-op)', () => {
    const killed: number[] = [];
    expect(stopMissionExecutor('apm_none', { findPids: () => [], killGroup: (p) => killed.push(p) })).toEqual([]);
    expect(killed).toEqual([]);
  });
});
