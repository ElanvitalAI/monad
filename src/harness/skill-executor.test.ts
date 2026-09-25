// 트랙 X1 — skill 도메인 executor + harness-seams execute 라우팅 테스트. fan-out/chain/write 는 fake 주입.
import { test, expect, describe } from 'bun:test';
import { buildSkillDomainExecute } from './skill-executor.js';
import { buildHarnessSeams } from './harness-seams.js';
import { realWorktreeSeams as fakeSeams } from './harness-test-seams.js';

describe('buildSkillDomainExecute (X1 skill executor)', () => {
  test('fan-out 산출을 worktree 파일로 materialize·changes 로 낸다', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const exec = buildSkillDomainExecute({
      outputFile: 'report.md',
      fanOut: async () => ({ source: 'luna', picked: ['omni-market'], results: [{ skill: 'omni-market', ok: true, output: 'X' }], combinedOutput: '[skill 산출]\nX' }),
      writeFile: (path, content) => writes.push({ path, content }),
    });
    const r = await exec({ objective: '삼성 매력도', round: 1, cwd: '/tmp/wt' });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual(['report.md']);
    expect(writes[0].path).toBe('/tmp/wt/report.md');
    expect(writes[0].content).toContain('[skill 산출]');
  });

  test('chain 모드 — chain 스텝 주면 S8 순차', async () => {
    let usedChain = false;
    const exec = buildSkillDomainExecute({
      chain: [{ skill: 'omni-market' }, { skill: 'omni-digest' }],
      runChain: async () => { usedChain = true; return { results: [{ skill: 'omni-market', ok: true, output: 'a' }], finalOutput: '최종' }; },
      fanOut: async () => { throw new Error('fan-out 불려선 안 됨'); },
      writeFile: () => {},
    });
    const r = await exec({ objective: 'g', round: 1, cwd: '/tmp/wt' });
    expect(usedChain).toBe(true);
    expect(r.ok).toBe(true);
  });

  test('skill 산출 없음 → ok:false·changes 0(하니스가 escalate 판정)', async () => {
    const exec = buildSkillDomainExecute({ fanOut: async () => null, writeFile: () => {} });
    const r = await exec({ objective: 'g', round: 1, cwd: '/tmp/wt' });
    expect(r.ok).toBe(false);
    expect(r.changes).toEqual([]);
  });

  test('priorFindings 가 objective 에 반영(rework)', async () => {
    let captured = '';
    const exec = buildSkillDomainExecute({
      fanOut: async (obj) => { captured = obj; return { source: 'luna', picked: [], results: [{ skill: 's', ok: true, output: 'o' }], combinedOutput: 'o' }; },
      writeFile: () => {},
    });
    await exec({ objective: 'base', round: 2, cwd: '/tmp/wt', priorFindings: ['누락된 케이스 X'] });
    expect(captured).toContain('[이전 리뷰 지적');
    expect(captured).toContain('누락된 케이스 X');
  });

  test('write 실패 → ok:false(fail-soft)', async () => {
    const exec = buildSkillDomainExecute({
      fanOut: async () => ({ source: 'luna', picked: [], results: [{ skill: 's', ok: true, output: 'o' }], combinedOutput: 'o' }),
      writeFile: () => { throw new Error('디스크 풀'); },
    });
    const r = await exec({ objective: 'g', round: 1, cwd: '/tmp/wt' });
    expect(r.ok).toBe(false);
  });
});

describe('harness-seams execute — X1 도메인 executor 라우팅', () => {
  test('domainExecute 주입 시 execute 가 코드 implement 대신 그걸 부른다', async () => {
    let implementCalled = false;
    let domainCalled = false;
    const s = buildHarnessSeams({
      seams: fakeSeams({ async implement() { implementCalled = true; return { ok: true, summary: 'code' }; } }),
      domainExecute: async () => { domainCalled = true; return { ok: true, summary: 'skill executor', changes: ['report.md'] }; },
    });
    await s.plan({ objective: '투자 리서치' });
    const r = await s.execute({ objective: '투자 리서치', steps: ['s'], round: 1 });
    expect(domainCalled).toBe(true);
    expect(implementCalled).toBe(false);   // 코드 executor 우회
    expect(r.changes).toEqual(['report.md']);
  });

  test('domainExecute 미주입 → 기본 코드 implement(무회귀)', async () => {
    let implementCalled = false;
    const s = buildHarnessSeams({
      seams: fakeSeams({ async implement() { implementCalled = true; return { ok: true, summary: 'code' }; } }),
    });
    await s.plan({ objective: 'x' });
    await s.execute({ objective: 'x', steps: ['s'], round: 1 });
    expect(implementCalled).toBe(true);
  });
});
