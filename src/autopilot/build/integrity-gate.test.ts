import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { createRunCmd, defaultRunCmd, runIntegrityGate } from './integrity-gate.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ignore-term-tree.js');

interface FixturePids {
  parentPid: number;
  grandchildPid?: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(25);
  }
  return predicate();
}

async function readFixturePids(path: string): Promise<FixturePids> {
  const ready = await waitUntil(() => {
    try {
      return readFileSync(path, 'utf8').length > 0;
    } catch {
      return false;
    }
  });
  if (!ready) throw new Error('fixture did not publish process ids');
  return JSON.parse(readFileSync(path, 'utf8')) as FixturePids;
}

function killProcessGroup(pgid: number | undefined): void {
  if (pgid === undefined) return;
  try {
    process.kill(process.platform === 'win32' ? pgid : -pgid, 'SIGKILL');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function makeStateFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'integrity-gate-tree-'));
  return { dir, path: join(dir, 'pids.json') };
}

describe('integrity gate platform test boundary', () => {
  test('Kotlin and Swift filters never reach Bun while TypeScript filters remain', async () => {
    const calls: string[][] = [];
    const result = await runIntegrityGate('/tmp', {
      steps: ['test'],
      testArgs: ['apps/android/src/test/FooTest.kt', 'apps/ios/Sources/Bar.swift', 'src/example.test.ts'],
      runCmd: async (_cmd, args) => {
        calls.push([...args]);
        return { code: 0, stdout: '1 pass\n0 fail\nRan 1 test across 1 file.\n', stderr: '', timedOut: false };
      },
    });

    expect(result.passed).toBe(true);
    expect(calls).toEqual([['test', 'src/example.test.ts']]);
  });

  test('platform-only filters skip Bun instead of restoring the full test suite', async () => {
    const calls: string[][] = [];
    const result = await runIntegrityGate('/tmp', {
      steps: ['test'],
      testArgs: ['apps/android/src/test/FooTest.kt', 'apps/ios/Sources/Bar.swift'],
      runCmd: async (_cmd, args) => {
        calls.push([...args]);
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    });

    expect(result.passed).toBe(true);
    expect(result.steps).toEqual([expect.objectContaining({ name: 'test', skipped: true })]);
    expect(calls).toEqual([]);
  });
});

describe('integrity gate process-tree timeout cleanup', () => {
  test('SIGTERM을 무시하는 직접 자식을 유예 뒤 SIGKILL로 종료하고 timedOut을 보존한다', async () => {
    const state = makeStateFile();
    let pgid: number | undefined;
    try {
      const running = defaultRunCmd(process.execPath, [fixture, 'direct', state.path], process.cwd(), 100);
      const pids = await readFixturePids(state.path);
      pgid = pids.parentPid;

      await Bun.sleep(250);
      expect(isAlive(pids.parentPid)).toBe(true);

      const result = await running;
      expect(result.timedOut).toBe(true);
      expect(result.code).toBe(124);
      expect(await waitUntil(() => !isAlive(pids.parentPid))).toBe(true);
    } finally {
      killProcessGroup(pgid);
      rmSync(state.dir, { recursive: true, force: true });
    }
  }, 10_000);

  test('부모 close 뒤에도 TERM을 무시한 손자를 grace 경계까지 살려 두고 그룹 SIGKILL로 거둔다', async () => {
    const state = makeStateFile();
    let pgid: number | undefined;
    try {
      const running = defaultRunCmd(process.execPath, [fixture, 'tree', state.path], process.cwd(), 100);
      const pids = await readFixturePids(state.path);
      pgid = pids.parentPid;
      const grandchildPid = pids.grandchildPid;
      if (grandchildPid === undefined) throw new Error('fixture did not publish grandchild pid');

      expect(await waitUntil(() => !isAlive(pids.parentPid), 1_000)).toBe(true);
      expect(isAlive(grandchildPid)).toBe(true);

      const result = await running;
      expect(result.timedOut).toBe(true);
      expect(result.code).toBe(124);
      expect(await waitUntil(() => !isAlive(grandchildPid))).toBe(true);
    } finally {
      killProcessGroup(pgid);
      rmSync(state.dir, { recursive: true, force: true });
    }
  }, 10_000);

  test('16MB 출력 한도를 넘긴 프로세스를 종료하고 ENOBUFS 실패로 반환한다', async () => {
    const state = makeStateFile();
    let pgid: number | undefined;
    try {
      const running = defaultRunCmd(process.execPath, [fixture, 'overflow', state.path], process.cwd(), 10_000);
      const pids = await readFixturePids(state.path);
      pgid = pids.parentPid;

      const result = await running;
      expect(result.code).not.toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.error?.code).toBe('ENOBUFS');
      expect(Buffer.byteLength(result.stdout)).toBe(16 * 1024 * 1024);
      expect(await waitUntil(() => !isAlive(pids.parentPid))).toBe(true);
    } finally {
      killProcessGroup(pgid);
      rmSync(state.dir, { recursive: true, force: true });
    }
  }, 10_000);

  test('spawn ENOENT를 uncaught error 대신 기존 실패 결과로 반환한다', async () => {
    await expect(defaultRunCmd('/definitely/missing/elanous-integrity-gate-command', [], process.cwd(), 500)).resolves.toEqual({
      code: 1, stdout: '', stderr: '', timedOut: false,
    });
  });

  // ⭐ 리뷰 must-fix 회귀 가드(2026-07-27) — reap 폴링에 데드라인이 없으면 좀비가 즉시 회수되지
  //   않는 환경에서 `processGroupExists` 가 계속 true 라 promise 가 **영원히 resolve 되지 않는다**.
  //   즉 "행(hang)을 없애는 수리"가 스스로 행을 만든다. SIGKILL 을 견디는 프로세스는 실물로 만들
  //   수 없으므로 프로브만 주입해 **데드라인이 실제로 promise 를 풀어주는지**를 결정론으로 잰다.
  test('그룹이 끝내 사라지지 않아도 데드라인 안에 결과를 낸다(무한 폴링 금지)', async () => {
    let probeCalls = 0;
    const neverGone = (): boolean => { probeCalls += 1; return true; };   // 영원히 "그룹 살아있음"
    const runCmd = createRunCmd(neverGone);
    const started = Date.now();
    const result = await runCmd(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), 200);
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(result.code).toBe(124);
    // 프로브가 계속 true 였는데도 풀렸다 = 데드라인이 일했다(폴링 소진이 아니라).
    expect(probeCalls).toBeGreaterThan(0);
    // 상한: timeout(200) + TERMINATION_GRACE(2000) + REAP_DEADLINE(2000) + 여유.
    expect(elapsed).toBeLessThan(8_000);
  }, 15_000);

  test('정상 exit 0과 exit 1의 code·stdout·stderr·timedOut 계약을 보존한다', async () => {
    await expect(defaultRunCmd(process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(0)"], process.cwd(), 500)).resolves.toEqual({
      code: 0, stdout: 'out', stderr: 'err', timedOut: false,
    });
    await expect(defaultRunCmd(process.execPath, ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(1)"], process.cwd(), 500)).resolves.toEqual({
      code: 1, stdout: 'out', stderr: 'err', timedOut: false,
    });
  });
});
