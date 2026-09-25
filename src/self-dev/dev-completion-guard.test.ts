import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  installDevCompletionGuard,
  shouldReportUnconcludedDevRun,
  UNOBSERVABLE_DEATHS,
  type DevCompletionGuardDependencies,
} from './dev-completion-guard.js';

function fixture() {
  const listeners: Record<'beforeExit' | 'exit', (() => void)[]> = { beforeExit: [], exit: [] };
  const lines: string[] = [];
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  let exitCode: number | undefined;
  let flushes = 0;
  const deps: DevCompletionGuardDependencies = {
    on: (event, listener) => { listeners[event].push(listener); },
    getExitCode: () => exitCode,
    setExitCode: (code) => { exitCode = code; },
    writeStderr: (line) => { lines.push(line); },
    log: (event, data) => { logs.push({ event, data }); },
    flush: () => { flushes += 1; },
  };
  return {
    guard: installDevCompletionGuard(deps),
    emit: (event: 'beforeExit' | 'exit') => listeners[event].forEach((listener) => listener()),
    lines,
    logs,
    get exitCode() { return exitCode; },
    get flushes() { return flushes; },
  };
}

function throwingFixture(broken: 'log' | 'writeStderr' | 'flush') {
  const listeners: Record<'beforeExit' | 'exit', (() => void)[]> = { beforeExit: [], exit: [] };
  const lines: string[] = [];
  const logs: string[] = [];
  let exitCode: number | undefined;
  let flushes = 0;
  const boom = (name: string) => { throw new Error(`${name} 채널이 죽었다`); };
  const deps: DevCompletionGuardDependencies = {
    on: (event, listener) => { listeners[event].push(listener); },
    getExitCode: () => exitCode,
    setExitCode: (code) => { exitCode = code; },
    writeStderr: (line) => { if (broken === 'writeStderr') boom('writeStderr'); lines.push(line); },
    log: (event) => { if (broken === 'log') boom('log'); logs.push(event); },
    flush: () => { if (broken === 'flush') boom('flush'); flushes += 1; },
  };
  installDevCompletionGuard(deps);
  return {
    emit: (event: 'beforeExit' | 'exit') => listeners[event].forEach((l) => l()),
    lines, logs,
    get exitCode() { return exitCode; },
    get flushes() { return flushes; },
  };
}

/**
 * ⛔⭐⭐⭐ **산출 채널이 던져도 종료 코드 보정은 «반드시» 수행된다**(무인 리뷰 must-fix · `#6976`).
 *   초판은 log→writeStderr→flush 를 먼저 부르고 보정을 «맨 끝»에 뒀다. 그래서 셋 중 하나만
 *   던져도 보정이 건너뛰어져 프로세스가 `exit 0` 으로 나갔다 —
 *   ***이 가드가 막으려던 「조용한 성공 위장」이 가드 자신 안에서 재현되는 형태였다.***
 */
/**
 * ⛔⭐⭐⭐ **보정이 산출보다 «먼저»인지를 «순서로» 관측한다.**
 *   위 「던져도 보정된다」 테스트만으로는 부족하다 — 각 채널이 fail-soft 라 던짐이 밖으로 안 나오고,
 *   그러면 보정을 «맨 끝»으로 되돌리는 뮤테이션이 «통과한다»(실측: 12 pass 0 fail).
 *   ⇒ ***방어가 둘이면 하나만으로도 테스트가 초록이 된다 — 그래서 각 방어를 «따로» 물어야 한다.***
 *   순서를 지키는 이유는 심층 방어다: 뒷날 누가 try/catch 를 지워도 보정은 이미 끝나 있다.
 */
describe('dev completion guard — 종료 코드 보정이 산출보다 «먼저»다', () => {
  it('setExitCode 가 log·writeStderr·flush «어느 것보다도» 앞선다', () => {
    const listeners: Record<'beforeExit' | 'exit', (() => void)[]> = { beforeExit: [], exit: [] };
    const order: string[] = [];
    let exitCode: number | undefined;
    const deps: DevCompletionGuardDependencies = {
      on: (event, listener) => { listeners[event].push(listener); },
      getExitCode: () => exitCode,
      setExitCode: (code) => { exitCode = code; order.push('setExitCode'); },
      writeStderr: () => { order.push('writeStderr'); },
      log: () => { order.push('log'); },
      flush: () => { order.push('flush'); },
    };
    installDevCompletionGuard(deps);
    listeners.beforeExit.forEach((l) => l());
    expect(order[0]).toBe('setExitCode');
    expect(order).toEqual(['setExitCode', 'log', 'writeStderr', 'flush']);
  });
});

describe('dev completion guard — 채널이 던져도 결론은 남는다', () => {
  for (const broken of ['log', 'writeStderr', 'flush'] as const) {
    it(`${broken} 채널이 던져도 종료 코드가 보정된다`, () => {
      const f = throwingFixture(broken);
      expect(() => f.emit('beforeExit')).not.toThrow();
      expect(f.exitCode).toBe(1);
    });
  }

  it('log 가 죽어도 stderr 와 flush 는 «나간다» — 채널이 서로 독립이다', () => {
    const f = throwingFixture('log');
    f.emit('beforeExit');
    expect(f.lines).toHaveLength(1);
    expect(f.flushes).toBe(1);
  });

  it('writeStderr 가 죽어도 log 와 flush 는 «나간다»', () => {
    const f = throwingFixture('writeStderr');
    f.emit('beforeExit');
    expect(f.logs).toEqual(['completion-missing']);
    expect(f.flushes).toBe(1);
  });
});

describe('dev completion guard', () => {
  it('순수 판정은 결론 없는 런만 보고한다', () => {
    expect(shouldReportUnconcludedDevRun(false)).toBe(true);
    expect(shouldReportUnconcludedDevRun(true)).toBe(false);
  });

  it('beforeExit에서 미결론 런을 한 번 기록·flush하고 exit 0을 실패로 정정한다', () => {
    const f = fixture();
    f.emit('beforeExit');
    expect(f.exitCode).toBe(1);
    expect(f.logs).toEqual([{ event: 'completion-missing', data: {
      phase: 'beforeExit',
      unobservableDeaths: ['SIGKILL', 'OOM kill', 'power loss'],
    } }]);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toContain('[dev completion guard]');
    expect(f.lines[0]).toContain('SIGKILL, OOM kill, power loss');
    expect(f.flushes).toBe(1);
  });

  it('beforeExit 재발화와 exit은 중복 산출하지 않는다', () => {
    const f = fixture();
    f.emit('beforeExit');
    f.emit('beforeExit');
    f.emit('exit');
    expect(f.logs).toHaveLength(1);
    expect(f.lines).toHaveLength(1);
    expect(f.flushes).toBe(1);
  });

  it('이미 결론 낸 런은 beforeExit과 exit에서 어떤 산출도 내지 않는다', () => {
    const f = fixture();
    f.guard.conclude();
    f.emit('beforeExit');
    f.emit('exit');
    expect(f.exitCode).toBeUndefined();
    expect(f.logs).toEqual([]);
    expect(f.lines).toEqual([]);
    expect(f.flushes).toBe(0);
  });

  it('exit 국면은 미결론 사실을 기록하되 확정된 종료 코드를 바꾸지 않는다', () => {
    const f = fixture();
    f.emit('exit');
    expect(f.exitCode).toBeUndefined();
    expect(f.logs[0]?.data.phase).toBe('exit');
  });

  it('못 보는 죽음 목록은 리터럴 계약을 보존한다', () => {
    expect(UNOBSERVABLE_DEATHS).toEqual(['SIGKILL', 'OOM kill', 'power loss']);
  });

  it('실물 Bun 프로세스에서 beforeExit가 실제로 가드를 발화하고 0이 아닌 코드로 끝난다', () => {
    const modulePath = resolve(import.meta.dir, 'dev-completion-guard.ts');
    const script = `import { installDevCompletionGuard } from ${JSON.stringify(modulePath)};\nconst events = [];\ninstallDevCompletionGuard({ on: (event, listener) => process.on(event, listener), getExitCode: () => process.exitCode, setExitCode: (code) => { process.exitCode = code; }, writeStderr: (line) => process.stderr.write(line), log: (event) => events.push(event), flush: () => {} });`;
    const result = spawnSync('bun', ['--eval', script], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[dev completion guard]');
    expect(result.stderr).toContain('SIGKILL, OOM kill, power loss');
  }, 15_000);
});
