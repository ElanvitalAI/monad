import { describe, it, expect } from 'bun:test';
import { setupStandaloneRunEnv, enterStandaloneHarnessRun } from './standalone-run-context.js';
import { HARNESS_SPACE_ENV, HARNESS_SPACE_ID_ENV, HARNESS_RUN_ID_ENV } from './harness-space.js';

const mkEnv = (o: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...o }) as NodeJS.ProcessEnv;

describe('setupStandaloneRunEnv — env 셋업(순수·부작용=env 쓰기)', () => {
  it('빈 env → space 마커 + runId mint(자식 상속용)', () => {
    const env = mkEnv();
    const ctx = setupStandaloneRunEnv('self-implement', 'my feature!!', env);
    expect(env[HARNESS_SPACE_ENV]).toBe('self-implement');
    expect(env[HARNESS_SPACE_ID_ENV]).toBe('my-feature'); // normalizeSpaceId(비안전문자 정리)
    expect(ctx.runId).toBeTruthy();
    expect(env[HARNESS_RUN_ID_ENV]).toBe(ctx.runId);       // env 에 stamp → 자식 상속
    expect(ctx.space?.kind).toBe('self-implement');
  });

  it('이미 SPACE_ID 있으면 존중(오케스트레이터 자식·seed 무시·runId 재mint X)', () => {
    const env = mkEnv({ [HARNESS_SPACE_ENV]: 'self-implement', [HARNESS_SPACE_ID_ENV]: 'child-job-7', [HARNESS_RUN_ID_ENV]: 'run-parent' });
    const ctx = setupStandaloneRunEnv('self-implement', 'other-seed', env);
    expect(env[HARNESS_SPACE_ID_ENV]).toBe('child-job-7'); // 덮어쓰기 금지(N잡 충돌 방지)
    expect(ctx.runId).toBe('run-parent');                  // 상속 runId 재mint 금지(§K 불변식)
  });
});

describe('enterStandaloneHarnessRun — 관측 배선(주입·fail-open)', () => {
  it('sink 등록(harness:<kind> surface) + harness.space·run-identity emit', async () => {
    const env = mkEnv();
    const sinks: string[] = [];
    const logs: { cat: string; evt: string }[] = [];
    const ctx = await enterStandaloneHarnessRun({ kind: 'self-implement', spaceSeed: 'feat' }, {
      env,
      registerSink: async (s) => { sinks.push(s); },
      debugLog: (cat, evt) => { logs.push({ cat, evt }); },
    });
    expect(sinks).toEqual(['harness:self-implement']);
    expect(logs).toEqual([{ cat: 'harness.space', evt: 'entered' }, { cat: 'run-identity', evt: 'bind' }]);
    expect(ctx.runId).toBeTruthy();
  });

  it('sink 등록 실패해도 fail-open(throw X·env 셋업은 유효·파일 트레일이 진실원)', async () => {
    const env = mkEnv();
    const ctx = await enterStandaloneHarnessRun({ kind: 'self-implement', spaceSeed: 'feat' }, {
      env,
      registerSink: async () => { throw new Error('sink 실패'); },
      debugLog: () => {},
    });
    expect(ctx.runId).toBeTruthy();                    // 예외 삼킴·컨텍스트 반환
    expect(env[HARNESS_SPACE_ENV]).toBe('self-implement');
  });
});
