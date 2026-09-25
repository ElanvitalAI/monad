// LG2 — 완료 전이 단일화 배선 검증 (2026-07-19)
//
// run-mission 은 detached 스크립트라 단위테스트 불가 → source-level 배선 assertion. 완료 판정 로직
// (FINITE + tasks.every(done))은 sweepFiniteMissions 와 동일(mission-lifecycle.test 가 커버).
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'scripts/run-mission.ts'), 'utf8');

describe('LG2 — 완료 전이 단일화(실행 완료→미션 done 게이트)', () => {
  test('run-mission 종료부가 exec-complete 로 게이트 done 전이', () => {
    expect(src).toMatch(/missionLifecycleGate\(mdb, missionId, 'done', 'exec-complete'\)/);
  });
  test('FINITE + 전 태스크 done 일 때만(sweepFinite 동일 판정)', () => {
    expect(src).toContain("missionKind(mrow?.execution_model ?? null) === 'finite'");
    expect(src).toMatch(/tasks\.every\(\(t\) => t\.status === 'done'\)/);
  });
  test('mp.failed===0 가드(부분 실패면 완료 전이 안 함)', () => {
    // exec-complete 게이트가 mp.failed===0 블록 안에 있어야(실패 있으면 done 금지).
    const gateIdx = src.indexOf("'exec-complete'");
    const guardIdx = src.lastIndexOf('if (mp.failed === 0)', gateIdx);
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(gateIdx);
  });
  test('fail-soft — 완료 전이 실패는 sweepFinite 안전망이 이어받음(주석 명시)', () => {
    expect(src).toContain('sweepFinite 안전망');
  });
});
