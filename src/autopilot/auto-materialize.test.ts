import { test, expect, describe } from 'bun:test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMaterializeMandate, evaluateMaterializeMandate, DISARMED_MANDATE, type MaterializeMandate } from './materialize-mandate.js';
import { armMission, autoMaterializeArmed } from './mission-engine.js';
import { openAutopilotMissionsDb, createMission, getMission } from './mission-registry.js';

const ARMED: MaterializeMandate = { armed: true, scope: { models: ['scheduler', 'task'], commandSources: ['scripts/'] }, maxActiveJobs: 10 };

describe('loadMaterializeMandate — fail-closed', () => {
  test('부재 = disarmed', () => {
    expect(loadMaterializeMandate('/nonexistent.json').armed).toBe(false);
    expect(DISARMED_MANDATE.armed).toBe(false);
  });
  test('armed=true 명시 + scope 파싱', () => {
    const p = join(tmpdir(), 'test-mandate.json');
    writeFileSync(p, JSON.stringify(ARMED));
    const m = loadMaterializeMandate(p);
    expect(m.armed).toBe(true);
    expect(m.scope.models).toEqual(['scheduler', 'task']);
    rmSync(p);
  });
});

describe('evaluateMaterializeMandate — 범위 게이트', () => {
  test('disarmed → 거부', () => {
    expect(evaluateMaterializeMandate(DISARMED_MANDATE, { executionModel: 'scheduler', activeCount: 0 }).allowed).toBe(false);
  });
  test('범위 밖 모델 → 거부', () => {
    expect(evaluateMaterializeMandate(ARMED, { executionModel: 'monitor-trigger', activeCount: 0 }).allowed).toBe(false);
  });
  test('command 화이트리스트 밖 → 거부', () => {
    const r = evaluateMaterializeMandate(ARMED, { executionModel: 'scheduler', command: 'rm -rf /', activeCount: 0 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('화이트리스트');
  });
  test('범위 내 command → 승인', () => {
    expect(evaluateMaterializeMandate(ARMED, { executionModel: 'scheduler', command: 'scripts/foo.ts', activeCount: 0 }).allowed).toBe(true);
  });
  test('상한 도달 → 거부', () => {
    expect(evaluateMaterializeMandate(ARMED, { executionModel: 'task', activeCount: 10 }).allowed).toBe(false);
  });
});

describe('armMission — HITL 승인·spec 저장', () => {
  test('spec 저장 + status=armed', () => {
    const real = openAutopilotMissionsDb();
    const m = createMission(real, { goal: 'arm 테스트', source: 'manual', triage: { executionModel: 'scheduler' } });
    real.close();
    expect(armMission(m.id, { command: 'scripts/x.ts', cron: '0 8 * * *' }).ok).toBe(true);
    const c = openAutopilotMissionsDb();
    const got = getMission(c, m.id)!;
    expect(got.status).toBe('armed');
    expect(JSON.parse(got.materialize_spec!)).toEqual({ command: 'scripts/x.ts', cron: '0 8 * * *' });
    c.deleteMission(m.id); c.close();
  });
});

describe('autoMaterializeArmed — mandate 게이트', () => {
  test('mandate disarmed → no-op', async () => {
    const r = await autoMaterializeArmed({ mandatePath: '/nonexistent.json' });
    expect(r.armed).toBe(false);
    expect(r.materialized).toBe(0);
  });
  test('mandate armed 이지만 범위 밖 command → skipped(materialize 0)', async () => {
    const real = openAutopilotMissionsDb();
    const m = createMission(real, { goal: '범위밖 테스트', source: 'manual', triage: { executionModel: 'scheduler' } });
    real.close();
    armMission(m.id, { command: '/usr/bin/danger', cron: '0 8 * * *' }); // scripts/ 밖
    const r = await autoMaterializeArmed({ mandate: ARMED });
    const mine = r.results.find(x => x.id === m.id);
    expect(mine?.skipped).toBeTruthy();
    expect(mine?.ok).toBe(false);
    const c = openAutopilotMissionsDb(); c.deleteMission(m.id); c.close();
  });
});
