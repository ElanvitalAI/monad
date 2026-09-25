// ── 데몬 컨트롤 헬퍼 테스트 (PR3 · 2026-07-13) ─────────────────────────────
// 환경별 재시작 계획(순수) + 3중 실행 게이트(dry-run 기본·권한·교차오염). 실 데몬 미접촉(cli seam).

import { describe, expect, it } from 'bun:test';
import { buildRestartPlan, detectDaemonEnvironment, restartDaemon } from './daemon-control.js';

const FAKE_LAUNCHD = { uid: 501, label: 'com.monad.nexus', platformOverride: 'darwin' as const };

describe('buildRestartPlan', () => {
  it('production → launchctl kickstart -k <serviceTarget>', () => {
    const p = buildRestartPlan('production', { launchd: FAKE_LAUNCHD });
    expect(p.env).toBe('production');
    expect(p.command).toEqual(['launchctl', 'kickstart', '-k', 'gui/501/com.monad.nexus']);
    expect(p.note).toContain('교차오염');
  });

  it('test → nexus run --test', () => {
    const p = buildRestartPlan('test');
    expect(p.env).toBe('test');
    expect(p.command.slice(-3)).toEqual(['nexus', 'run', '--test']);
  });
});

describe('detectDaemonEnvironment', () => {
  it('env 명시 최우선', () => {
    expect(detectDaemonEnvironment({ env: 'test' })).toBe('test');
    expect(detectDaemonEnvironment({ env: 'production' })).toBe('production');
  });
  it('기본 production(보수적)', () => {
    // 현 테스트 러너 argv 에 --test 가 없으면 production.
    if (!process.argv.includes('--test')) expect(detectDaemonEnvironment()).toBe('production');
  });
});

describe('restartDaemon — 3중 게이트', () => {
  it('기본 dry-run(계획만·executed=false·실 cli 미호출)', async () => {
    let called = false;
    const r = await restartDaemon({ env: 'production', launchd: FAKE_LAUNCHD, runCli: async () => { called = true; return { stdout: '', stderr: '', exitCode: 0 }; } });
    expect(r.ok).toBe(true);
    expect(r.executed).toBe(false);
    expect(called).toBe(false);
    expect(r.reason).toContain('dry-run');
    expect(r.plan.command[0]).toBe('launchctl');
  });

  it('execute 하지만 무권한 → 거부(executed=false)', async () => {
    let called = false;
    const r = await restartDaemon({ env: 'production', execute: true, authorized: false, launchd: FAKE_LAUNCHD, runCli: async () => { called = true; return { stdout: '', stderr: '', exitCode: 0 }; } });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(called).toBe(false);
    expect(r.reason).toContain('권한');
  });

  it('교차오염 가드 — 요청 env != 감지 env 거부', async () => {
    let called = false;
    // 감지=production(argv 무 --test), 요청=test → mismatch 거부.
    const r = await restartDaemon({ env: 'test', execute: true, authorized: true, runCli: async () => { called = true; return { stdout: '', stderr: '', exitCode: 0 }; } });
    if (!process.argv.includes('--test')) {
      expect(r.ok).toBe(false);
      expect(r.executed).toBe(false);
      expect(called).toBe(false);
      expect(r.reason).toContain('교차오염');
    }
  });

  it('execute+authorized+env 일치 → 실제 실행(cli 호출·exit0)', async () => {
    let cmd: string[] = [];
    const r = await restartDaemon({ env: 'production', execute: true, authorized: true, launchd: FAKE_LAUNCHD, runCli: async (c) => { cmd = c; return { stdout: 'ok', stderr: '', exitCode: 0 }; } });
    expect(r.ok).toBe(true);
    expect(r.executed).toBe(true);
    expect(cmd).toEqual(['launchctl', 'kickstart', '-k', 'gui/501/com.monad.nexus']);
  });

  it('exit!=0 → ok=false·사유 캡처', async () => {
    const r = await restartDaemon({ env: 'production', execute: true, authorized: true, launchd: FAKE_LAUNCHD, runCli: async () => ({ stdout: '', stderr: 'no such service', exitCode: 1 }) });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(true);
    expect(r.reason).toContain('no such service');
  });

  it('forceEnvMismatch → 가드 우회 실행', async () => {
    let called = false;
    const r = await restartDaemon({ env: 'test', execute: true, authorized: true, forceEnvMismatch: true, runCli: async () => { called = true; return { stdout: '', stderr: '', exitCode: 0 }; } });
    expect(r.executed).toBe(true);
    expect(called).toBe(true);
  });
});
