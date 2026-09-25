import { afterEach, describe, expect, it } from 'bun:test';
import { debug } from '../debug/log.js';
import { setGitCommandRunnerForTesting } from '../git-fs/runner.js';
import { runOrphanSweepCli, type OrphanSweepDeps } from './orphan-sweep-cli.js';
import type { PreviousSweep, SweepSnapshot, SweepVerdict } from './orphan-test-sweep.js';

afterEach(() => setGitCommandRunnerForTesting(undefined));

// `src/a.ts` ↔ `src/a.test.ts` 는 co-located 라 유도가 닿는다.
// `test/dark.test.ts` 는 어떤 소스도 그 셋(co-located · 평탄 · 중첩)으로 못 만든다 ⇒ 어두운 고아.
const FILES = ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'test/dark.test.ts'];

function deps(overrides: OrphanSweepDeps = {}): OrphanSweepDeps {
  return {
    listFiles: () => FILES,
    exists: (path) => FILES.includes(path),
    runTest: () => 'green',
    buildIndex: () => ({ testsBySource: new Map(), unresolvedRelativeSpecifiers: 0 }),
    readSnapshot: () => ({ kind: 'absent', reason: 'no-history' }),
    writeSnapshot: () => {},
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    ...overrides,
  };
}

describe('runOrphanSweepCli', () => {
  it('기본은 «세기만» 한다 — 86 파일 실행을 기본값으로 물리지 않는다', () => {
    let ran = 0;
    const result = runOrphanSweepCli('/repo', {}, deps({ runTest: () => { ran += 1; return 'green'; } }));
    expect(ran).toBe(0);
    expect(result.lines[1]).toContain('red=«미측정»');
    expect(result.exitCode).toBe(0);
  });

  it('--run 이면 어두운 것만 돌리고 「수 ⊕ 어제 값」을 낸다', () => {
    const seen: string[] = [];
    const result = runOrphanSweepCli('/repo', { run: true }, deps({
      runTest: (_cwd, test) => { seen.push(test); return 'red' as SweepVerdict; },
    }));
    // ⛔ 유도가 닿는 src/a.test.ts 는 «안» 돌린다 — 그건 게이트가 이미 본다.
    expect(seen).toEqual(['test/dark.test.ts']);
    expect(result.lines.at(-1)).toContain('red=1 (어제 값 없음 — 첫 관측)');
  });

  it('비교를 «낸 뒤에» 쓴다 — 오늘 값이 자기 자신의 「어제」가 되면 안 된다', () => {
    const writes: SweepSnapshot[] = [];
    const previous: PreviousSweep = {
      kind: 'present',
      snapshot: { at: '2026-08-24T12:00:00.000Z', dark: 1, counts: { green: 1, red: 0, timeout: 0, unrun: 0 } },
    };
    const result = runOrphanSweepCli('/repo', { run: true }, deps({
      runTest: () => 'red', readSnapshot: () => previous, writeSnapshot: (s) => writes.push(s),
    }));
    expect(result.lines.at(-1)).toContain('어제 red=0 +1');
    expect(writes).toHaveLength(1);
    expect(writes[0].counts.red).toBe(1);
  });

  // ⛔⭐ 「18」만 있고 이름이 «아무 데도» 없으면 그 수는 행동으로 안 이어진다.
  //   줄은 수로 두되(🅣 계약), 이름은 «관측»으로 꺼낼 수 있어야 한다.
  it('빨강·행의 «이름»을 관측에 남긴다 — 줄에는 안 넣는다', () => {
    const events: Array<Record<string, unknown>> = [];
    const originalLog = debug.log;
    const opts: Array<Record<string, unknown> | undefined> = [];
    (debug as { log: unknown }).log = (_c: string, event: string, data?: Record<string, unknown>, o?: Record<string, unknown>) => {
      if (event === 'swept' && data) { events.push(data); opts.push(o); }
    };
    try {
      const result = runOrphanSweepCli('/repo', { run: true }, deps({ runTest: () => 'red' }));
      expect(result.lines.at(-1)).not.toContain('test/dark.test.ts');   // 줄은 «수»만
      expect(events).toHaveLength(1);
      expect(events[0].redFiles).toEqual(['test/dark.test.ts']);        // 이름은 «관측»에
      expect(events[0].timeoutFiles).toEqual([]);
      // ⛔⭐ 기본 압축이 배열을 6에서 자른다 — 그대로 두면 빨강 18 중 «6개»만 회수된다(실측).
      //   ⇒ 이 이벤트는 «전량»을 남기라고 «명시»해야 한다. 안 하면 회수 경로가 1/3만 돈다.
      expect((opts[0]?.compact as { arrayMax?: number } | undefined)?.arrayMax ?? 0).toBeGreaterThanOrEqual(100);
    } finally {
      (debug as { log: unknown }).log = originalLog;
    }
  });

  // ⛔⭐ 🅣 정책 §2 — 관문화하지 «않는다». 내 변경과 무관한 빨강으로 사람을 막으면
  //   그 실패가 「내 변경 탓」으로 오독된다.
  it('빨강이 있어도 exit 0 이다 — 보고형이지 관문이 아니다', () => {
    const result = runOrphanSweepCli('/repo', { run: true }, deps({ runTest: () => 'red' }));
    expect(result.exitCode).toBe(0);
  });

  it('색인을 못 만들면 「고아 0」이 아니라 exit 1 로 «못 쟀다»고 말한다', () => {
    // 실물에서는 시험 파일을 못 읽을 때 색인이 null 이 된다 — 그 갈래를 이음매로 세운다.
    const result = runOrphanSweepCli('/repo', {}, deps({ buildIndex: () => null }));
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain('lookup failed');
  });

  it('기본 listFiles 는 공용 심 stdout 과 maxBuffer 를 유지하고 성공 목록을 낸다', () => {
    const seen: Array<{ cwd: string; args: string[]; maxBuffer: unknown; encoding: unknown }> = [];
    setGitCommandRunnerForTesting((cwd, args, options) => {
      seen.push({ cwd, args: [...args], maxBuffer: options.maxBuffer, encoding: options.encoding });
      return { status: 0, stdout: `${FILES.join('\n')}\n`, stderr: '' };
    });
    const result = runOrphanSweepCli('/repo', {}, {
      exists: (path) => FILES.includes(path),
      buildIndex: () => ({ testsBySource: new Map(), unresolvedRelativeSpecifiers: 0 }),
      readSnapshot: () => ({ kind: 'absent', reason: 'no-history' }),
      writeSnapshot: () => {},
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });
    expect(seen).toEqual([{ cwd: '/repo', args: ['ls-files'], maxBuffer: 1 << 28, encoding: 'utf8' }]);
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain('dark=1');
  });

  it('기본 listFiles 는 0 이 아닌 status 를 성공 목록으로 접지 않는다', () => {
    setGitCommandRunnerForTesting(() => ({
      status: 128,
      stdout: `${FILES.join('\n')}\n`,
      stderr: 'fatal: not a git repository',
    }));
    expect(() => runOrphanSweepCli('/repo', {}, {
      exists: (path) => FILES.includes(path),
      buildIndex: () => ({ testsBySource: new Map(), unresolvedRelativeSpecifiers: 0 }),
    })).toThrow(/fatal: not a git repository/);
  });
});
