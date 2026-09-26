// attemptsForPhase — 빌드 레코드 → PhaseAttempt 트레일 (P6 · 2026-07-13).
// PhaseOutcome.attempts 가 summary regex 재구성이 아니라 se_builds 실기록에서 오는지의 계약.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSeBuildsDb, upsertBuild, makeBuildId, attemptsForPhase } from './se-build-registry.js';

const PHASE = 'task:0808d01fabcd';

function seed(dbPath: string): void {
  const db = openSeBuildsDb(dbPath);
  try {
    const base = { missionId: 'apm_x', phaseId: PHASE, phaseTitle: 'P2 검증', index: 2, total: 7, now: () => '2026-07-13T00:00:00Z' };
    upsertBuild(db, { ...base, buildId: makeBuildId(PHASE, 1), attemptSeq: 1, backend: 'elanous-self:gpt-5.6-terra', status: 'gate-failed', maxTurns: 150, gateResult: 'bun test 3 fail' });
    upsertBuild(db, { ...base, buildId: makeBuildId(PHASE, 2), attemptSeq: 2, backend: 'elanous-self:gpt-5.6-terra', status: 'gate-failed', maxTurns: 1000 });
    upsertBuild(db, { ...base, buildId: makeBuildId(PHASE, 3), attemptSeq: 3, backend: 'opus-4.8', status: 'failed' });
    upsertBuild(db, { ...base, buildId: makeBuildId(PHASE, 4), attemptSeq: 4, backend: 'opus-4.8', status: 'running' }); // 진행중 — 제외
  } finally { db.close(); }
}

describe('attemptsForPhase — 실측 시도 트레일', () => {
  test('attemptSeq 순 매핑 · running 제외 · gate 매핑(gate-failed/error) · 발췌 보존', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'sebuilds-')), 'se_builds.db');
    seed(dbPath);
    const attempts = attemptsForPhase(PHASE, dbPath);
    expect(attempts.length).toBe(3);
    expect(attempts[0]).toEqual({ backend: 'elanous-self:gpt-5.6-terra', maxTurns: 150, gateResult: 'gate-failed', gateOutputExcerpt: 'bun test 3 fail' });
    expect(attempts[1]!.maxTurns).toBe(1000);
    expect(attempts[2]).toEqual({ backend: 'opus-4.8', gateResult: 'error' });
  });

  test('기록 없는 페이즈 → [] (호출측 regex 폴백)', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'sebuilds2-')), 'se_builds.db');
    expect(attemptsForPhase('task:none', dbPath)).toEqual([]);
  });
});
