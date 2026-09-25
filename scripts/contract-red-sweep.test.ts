import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContractRedSweepScope, parseTestSummary, runBunTest, sweepContractReds, type FileDiscoverer, type FileRunner } from './contract-red-sweep.js';
import { remeasureStoredReds } from './contract-red-freshness.js';

const summary = (pass: number, fail: number) => ` ${pass} pass\n ${fail} fail\n`;
const discovered = (files: string[]): FileDiscoverer => async () => files;
const runner = (outputs: Record<string, Parameters<FileRunner>[0] extends never ? never : { stdout: string; stderr: string; exitCode: number | null; signal?: string | null }>): FileRunner => async (file) => outputs[file];
const expectCreatedAt = (report: { createdAt: string }) => expect(report.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

describe('contract red sweep', () => {
  test('순수 스코프 보고는 3개 본 파일과 10개 추적 파일에서 3·10·7을 센다', () => {
    const scope = buildContractRedSweepScope(['axis-b', 'axis-a', 'axis-a'], ['seen/a.test.ts', 'seen/b.test.ts', 'seen/c.test.ts'], { status: 'available', files: [...Array(10)].map((_, index) => index < 3 ? `seen/${String.fromCharCode(97 + index)}.test.ts` : `other/${index}.test.ts`) });
    expect(scope).toEqual({ axes: ['axis-a', 'axis-b'], observedFiles: 3, trackedTestFiles: 10, unobservedFiles: 7, excludedFiles: 0 });
  });

  test('순수 스코프 보고는 서로 다른 단일 파일 목록을 교집합 밖 제외와 안 본 파일로 센다', () => {
    const scope = buildContractRedSweepScope(['axis'], ['observed.test.ts'], { status: 'available', files: ['tracked.test.ts'] });
    expect(scope).toMatchObject({ observedFiles: 0, trackedTestFiles: 1, unobservedFiles: 1, excludedFiles: 1 });
  });

  test('순수 스코프 보고는 저장소 밖 본 파일을 제외하고 안 본 수를 같은 모집단에서 센다', () => {
    const scope = buildContractRedSweepScope(['axis'], ['tracked.test.ts', 'outside.test.ts'], { status: 'available', files: ['tracked.test.ts'] });
    expect(scope).toMatchObject({ observedFiles: 1, unobservedFiles: 0, excludedFiles: 1 });
  });

  test('순수 스코프 보고는 추적 목록을 못 얻으면 수 대신 unavailable 값을 남긴다', () => {
    const scope = buildContractRedSweepScope(['axis'], ['seen.test.ts'], { status: 'unavailable', error: 'git unavailable' });
    expect(scope).toMatchObject({ observedFiles: 1, trackedTestFiles: { status: 'unavailable', error: 'git unavailable' }, unobservedFiles: { status: 'unavailable', error: 'git unavailable' } });
  });

  test('초록만 있을 때 파일별 pass와 0 fail, 호출 시각 ISO를 보존한다', async () => {
    const before = Date.now();
    const report = await sweepContractReds(['axis'], { discover: discovered(['b.test.ts', 'a.test.ts']), discoverTracked: async () => ['a.test.ts', 'b.test.ts', 'outside.test.ts'], run: runner({ 'a.test.ts': { stdout: summary(3, 0), stderr: '', exitCode: 0 }, 'b.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: 0 } }) });
    const after = Date.now();
    expect(report).toMatchObject({ status: 'ok', filesScanned: 2, redFiles: 0, unmeasurableFiles: 0, scope: { axes: ['axis'], observedFiles: 2, trackedTestFiles: 3, unobservedFiles: 1, excludedFiles: 0 }, files: [{ file: 'a.test.ts', status: 'green', pass: 3, fail: 0 }, { file: 'b.test.ts', status: 'green', pass: 1, fail: 0 }] });
    expectCreatedAt(report);
    expect(Date.parse(report.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(report.createdAt)).toBeLessThanOrEqual(after);
  });

  test('스윕 빨강 보고는 신선도 소비자에서 시각 거부 없이 후보를 재측정한다', async () => {
    const report = await sweepContractReds(['axis'], {
      discover: discovered(['red.test.ts']),
      discoverTracked: async () => ['red.test.ts'],
      run: runner({ 'red.test.ts': { stdout: summary(2, 1), stderr: '', exitCode: 1 } }),
    });
    const freshness = await remeasureStoredReds(report, {
      now: () => new Date(Date.parse(report.createdAt) + 1),
      exists: async () => true,
      run: async () => ({ stdout: summary(3, 0), stderr: '', exitCode: 0 }),
    });
    expect(freshness).toMatchObject({ status: 'ok', candidates: 1, nowGreen: 1, unmeasurable: 0 });
    expect(freshness.files[0]).not.toMatchObject({ reason: 'missing-report-timestamp' });
  });

  test('추적 목록과 교집합만 실행하고 제외 수와 안 본 파일 수를 같은 모집단에서 센다', async () => {
    const report = await sweepContractReds(['axis'], {
      discover: discovered(['dependency/a.test.ts', 'dependency/b.test.ts', 'dependency/c.test.ts', 'tracked/one.test.ts', 'tracked/two.test.ts']),
      discoverTracked: async () => ['tracked/one.test.ts', 'tracked/two.test.ts', 'tracked/unobserved.test.ts'],
      run: runner({
        'tracked/one.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: 0 },
        'tracked/two.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: 0 },
      }),
    });
    expect(report).toMatchObject({
      status: 'ok',
      discovery: { status: 'ok', files: ['tracked/one.test.ts', 'tracked/two.test.ts'] },
      filesScanned: 2,
      scope: { observedFiles: 2, trackedTestFiles: 3, excludedFiles: 3, unobservedFiles: 1 },
    });
  });

  test('추적 목록 취득 실패는 검사 대상을 보존하고 제외 수를 unavailable로 남긴다', async () => {
    const files = ['one.test.ts', 'two.test.ts', 'three.test.ts', 'four.test.ts', 'five.test.ts'];
    const report = await sweepContractReds(['axis'], {
      discover: discovered(files),
      discoverTracked: async () => { throw new Error('git unavailable'); },
      run: runner(Object.fromEntries(files.map((file) => [file, { stdout: summary(1, 0), stderr: '', exitCode: 0 }]))),
    });
    const unavailable = { status: 'unavailable', error: 'git unavailable' };
    expect(report).toMatchObject({ status: 'ok', filesScanned: 5, scope: { observedFiles: 5, trackedTestFiles: unavailable, unobservedFiles: unavailable, excludedFiles: unavailable } });
  });

  test('추적 목록 취득 실패는 실행 상태를 바꾸지 않고 scope에만 남긴다', async () => {
    const report = await sweepContractReds(['axis'], { discover: discovered(['green.test.ts']), discoverTracked: async () => { throw new Error('git unavailable'); }, run: runner({ 'green.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: 0 } }) });
    expect(report).toMatchObject({ status: 'ok', filesScanned: 1, redFiles: 0, unmeasurableFiles: 0, scope: { axes: ['axis'], observedFiles: 1, trackedTestFiles: { status: 'unavailable', error: 'git unavailable' }, unobservedFiles: { status: 'unavailable', error: 'git unavailable' }, excludedFiles: { status: 'unavailable', error: 'git unavailable' } } });
  });

  test('비영 종료 코드여도 유효한 fail 요약이면 빨강으로 센다', async () => {
    const report = await sweepContractReds(['axis'], { discover: discovered(['red.test.ts', 'green.test.ts']), discoverTracked: async () => ['red.test.ts', 'green.test.ts'], run: runner({ 'red.test.ts': { stdout: summary(2, 1), stderr: '', exitCode: 1 }, 'green.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: 0 } }) });
    expect(report.redFiles).toBe(1);
    expect(report.files[1]).toMatchObject({ status: 'red', fail: 1, exitCode: 1 });
  });

  test('요약 줄이 없는 파일은 초록이 아닌 못 잰 파일이다', async () => {
    const report = await sweepContractReds(['axis'], { discover: discovered(['missing.test.ts']), discoverTracked: async () => ['missing.test.ts'], run: runner({ 'missing.test.ts': { stdout: 'crashed before tests', stderr: '', exitCode: 1 } }) });
    expect(report).toMatchObject({ status: 'ok', redFiles: 0, unmeasurableFiles: 1, files: [{ status: 'unmeasurable', pass: null, fail: null }] });
  });

  test('runner throw와 비정상 종료는 못 쟀다', async () => {
    const thrown = await sweepContractReds(['axis'], { discover: discovered(['throw.test.ts']), discoverTracked: async () => ['throw.test.ts'], run: async () => { throw new Error('spawn failed'); } });
    const signaled = await sweepContractReds(['axis'], { discover: discovered(['signal.test.ts']), discoverTracked: async () => ['signal.test.ts'], run: runner({ 'signal.test.ts': { stdout: summary(1, 0), stderr: '', exitCode: null, signal: 'SIGKILL' } }) });
    expect(thrown.files[0]).toMatchObject({ status: 'unmeasurable', error: 'spawn failed' });
    expect(signaled.files[0]).toMatchObject({ status: 'unmeasurable', error: 'runner terminated by SIGKILL' });
  });

  test('빈 발견, 발견 실패, 중복 축·파일 정렬, 상한을 서로 다른 값으로 보존한다', async () => {
    const empty = await sweepContractReds(['axis'], { discover: discovered([]), discoverTracked: async () => [] });
    let trackedCalls = 0;
    const failed = await sweepContractReds(['axis'], {
      discover: async () => { throw new Error('unreadable axis'); },
      discoverTracked: async () => { trackedCalls += 1; return ['tracked.test.ts']; },
    });
    const trackedFailed = await sweepContractReds(['axis'], {
      discover: async () => { throw new Error('unreadable axis'); },
      discoverTracked: async () => { throw new Error('git unavailable'); },
    });
    const limited = await sweepContractReds(['b', 'a', 'b'], { discover: async (axis) => axis === 'a' ? ['z.test.ts', 'a.test.ts'] : ['a.test.ts', 'b.test.ts'], discoverTracked: async () => ['a.test.ts', 'b.test.ts', 'z.test.ts'], run: async () => ({ stdout: summary(1, 0), stderr: '', exitCode: 0 }), limit: 2 });
    expect(empty).toMatchObject({ status: 'empty', discovery: { status: 'empty' }, filesScanned: 0 });
    expect(failed).toMatchObject({ status: 'failed', discovery: { status: 'failed', error: 'unreadable axis' }, scope: { observedFiles: 0, trackedTestFiles: 1, unobservedFiles: 1 } });
    expect(trackedCalls).toBe(1);
    expect(trackedFailed).toMatchObject({ status: 'failed', discovery: { status: 'failed', error: 'unreadable axis' }, scope: { trackedTestFiles: { status: 'unavailable', error: 'git unavailable' }, unobservedFiles: { status: 'unavailable', error: 'git unavailable' } } });
    expect(limited).toMatchObject({ status: 'limit-reached', limit: 2, files: [{ file: 'a.test.ts' }, { file: 'b.test.ts' }] });
    [empty, failed, trackedFailed, limited].forEach(expectCreatedAt);
  });

  test('실제 Bun 자식의 시그널 종료는 요약보다 우선해 못 잰 파일로 분류한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'contract-red-sweep-signal-'));
    const file = join(directory, 'signal.test.ts');
    try {
      await writeFile(file, "process.stdout.write(' 1 pass\\n 0 fail\\n'); process.kill(process.pid, 'SIGTERM');\n");
      const result = await runBunTest(file);
      const report = await sweepContractReds(['axis'], { discover: discovered([file]), discoverTracked: async () => [file], run: async () => result });
      expect(result.signal).toBe('SIGTERM');
      expect(report.files[0]).toMatchObject({ status: 'unmeasurable', error: 'runner terminated by SIGTERM' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('모호한 요약은 못 잰 상태로 파싱한다', () => {
    expect(parseTestSummary(`${summary(1, 0)}${summary(2, 0)}`)).toBeNull();
  });
});
