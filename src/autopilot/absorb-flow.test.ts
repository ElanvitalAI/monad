// Autopilot absorb-flow(P2) + arming 단위테스트 — 주입 deps(무네트워크·무DB).
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAutopilotArming, DISARMED, type AutopilotArming } from './arming.js';
import { buildAbsorbTask, runAbsorbFlow, type AbsorbCandidate } from './absorb-flow.js';

const CAND: AbsorbCandidate = {
  repo: 'openai/codex', key: 'codex', commitSha: 'abc1234def',
  title: 'feat: new agent memory loop', rationale: '메모리 루프 흡수 후보',
};
const armed = (over: Partial<AutopilotArming['absorb']> = {}): AutopilotArming => ({
  ...DISARMED, absorb: { armed: true, backend: 'claude', ...over },
});

describe('loadAutopilotArming — fail-closed', () => {
  test('부재 → DISARMED', () => {
    expect(loadAutopilotArming('/nonexistent/autopilot.json')).toEqual(DISARMED);
  });
  test('손상 JSON → DISARMED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-'));
    const p = join(dir, 'autopilot.json');
    writeFileSync(p, '{ broken');
    expect(loadAutopilotArming(p).absorb.armed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  test('armed=true 명시만 인정', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-'));
    const p = join(dir, 'autopilot.json');
    writeFileSync(p, JSON.stringify({ absorb: { armed: true, backend: 'codex-app-server' }, merge: { armed: 'yes' } }));
    const a = loadAutopilotArming(p);
    expect(a.absorb.armed).toBe(true);
    expect(a.absorb.backend).toBe('codex-app-server');
    expect(a.merge.armed).toBe(false); // 'yes' 는 true 아님 → false
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildAbsorbTask', () => {
  test('맥락 + 불변코어 금지 + merge 금지 포함', () => {
    const t = buildAbsorbTask(CAND);
    expect(t).toContain('openai/codex');
    expect(t).toContain('abc1234');
    expect(t).toContain('불변 코어');
    expect(t).toContain('merge 는 하지 마라');
  });
});

describe('runAbsorbFlow — arming 게이트', () => {
  test('disarmed → 제안만(delegate 미호출)', async () => {
    let delegated = false;
    const records: any[] = [];
    const r = await runAbsorbFlow(CAND, DISARMED, {
      delegate: async () => { delegated = true; return 'x'; },
      record: (x) => records.push(x),
    });
    expect(r.status).toBe('disarmed');
    expect(delegated).toBe(false);
    expect(records[0].outcome).toContain('disarmed');
  });

  test('armed + 빌드/테스트 통과 → drafted(merge 대기 HITL)', async () => {
    const r = await runAbsorbFlow(CAND, armed(), {
      delegate: async (task, backend) => `PR 초안 완료 (${backend})\n${task.slice(0, 10)}`,
      runBuild: async () => true,
      runTest: async () => true,
    });
    expect(r.status).toBe('drafted');
    expect(r.evidence).toEqual({ build: 'pass', test: 'pass', log: 'build=pass test=pass' });
    expect(r.next).toContain('HITL');
    expect(r.draft).toContain('PR 초안 완료');
  });

  test('armed + 테스트 실패 → evidence-failed(merge 차단)', async () => {
    const r = await runAbsorbFlow(CAND, armed(), {
      delegate: async () => 'draft',
      runBuild: async () => true,
      runTest: async () => false,
    });
    expect(r.status).toBe('evidence-failed');
    expect(r.evidence!.test).toBe('fail');
    expect(r.next).toContain('차단');
  });

  test('delegate throw → delegate-failed', async () => {
    const r = await runAbsorbFlow(CAND, armed(), {
      delegate: async () => { throw new Error('acp down'); },
    });
    expect(r.status).toBe('delegate-failed');
  });

  test('빌드/테스트 미주입 → skipped(통과로 간주)', async () => {
    const r = await runAbsorbFlow(CAND, armed(), { delegate: async () => 'draft' });
    expect(r.status).toBe('drafted');
    expect(r.evidence).toEqual({ build: 'skipped', test: 'skipped', log: 'build=skipped test=skipped' });
  });
});
