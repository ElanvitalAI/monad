import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import { runGitCommand } from '../git-fs/runner.js';
import { deriveRelatedTests } from './gate-scope.js';
import { buildImporterTestIndex, isTestPath } from './importer-test-index.js';
import {
  formatPartitionSummary, formatSweepNotRun, formatSweepReport, partitionOrphanTests, tallySweep,
  type PreviousSweep, type SweepSnapshot, type SweepVerdict,
} from './orphan-test-sweep.js';

const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;
/** ⛔ 한 파일이 행(hang)이면 전수 전체가 멎는다 — 게이트가 2026-07-26 에 그 사고를 겪었다.
 *  ⇒ 파일마다 잘라내고, 잘린 것은 「빨강」이 아니라 `timeout` 이라는 «다른 값»으로 센다. */
const DEFAULT_FILE_TIMEOUT_MS = 90_000;
const TIMEOUT_EXIT = 124;

export interface OrphanSweepDeps {
  readonly listFiles?: (cwd: string) => readonly string[];
  readonly exists?: (path: string) => boolean;
  readonly runTest?: (cwd: string, testPath: string, timeoutMs: number) => SweepVerdict;
  /** ⛔ `buildImporterTestIndex` 는 파일시스템을 «직접» 읽는다 — 이음매가 없으면 이 명령의
   *  판정 계약(관문 아님 · 색인 실패는 exit 1)을 시험이 «전혀» 물 수 없다. */
  readonly buildIndex?: typeof buildImporterTestIndex;
  readonly readSnapshot?: () => PreviousSweep;
  readonly writeSnapshot?: (snapshot: SweepSnapshot) => void;
  readonly now?: () => Date;
  /** ⛔ 부하를 «못 읽으면» 0 이 아니라 undefined 다 — 「한가했다」로 읽히면 안 된다. */
  readonly loadAverage?: () => number | undefined;
}

export interface OrphanSweepOptions {
  /** 전수를 «실제로 돌린다». 기본은 세기만 — 86 파일 실행은 분 단위라 기본값으로 물릴 수 없다. */
  readonly run?: boolean;
  readonly timeoutMs?: number;
}

export interface OrphanSweepResult {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

function defaultListFiles(cwd: string): readonly string[] {
  const result = runGitCommand(cwd, ['ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-files failed (status=${result.status})`);
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function defaultRunTest(cwd: string, testPath: string, timeoutMs: number): SweepVerdict {
  try {
    execFileSync('bun', ['test', `./${testPath}`], { cwd, timeout: timeoutMs, stdio: 'ignore' });
    return 'green';
  } catch (error) {
    const signal = (error as { signal?: string }).signal;
    const status = (error as { status?: number }).status;
    // ⛔⭐ 「죽였다」와 「빨갛다」를 같은 값으로 접지 않는다. execFileSync 는 timeout 을
    //   SIGTERM 으로 알리고 status 는 null 이 된다 — 그때 `red` 로 세면 없는 회귀가 생긴다.
    if (signal === 'SIGTERM' || signal === 'SIGKILL' || status === TIMEOUT_EXIT) return 'timeout';
    return 'red';
  }
}

/** ⛔ 실패를 0 으로 접지 않는다 — 「부하 0」과 「못 읽었다」는 다른 값이다. */
function defaultLoadAverage(): number | undefined {
  try { const [oneMinute] = loadavg(); return Number.isFinite(oneMinute) ? oneMinute : undefined; }
  catch { return undefined; }
}

function snapshotPath(): string { return join(monadStateRoot(), 'self-implement', 'orphan-sweep.json'); }

function defaultReadSnapshot(): PreviousSweep {
  const path = snapshotPath();
  if (!existsSync(path)) return { kind: 'absent', reason: 'no-history' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SweepSnapshot;
    if (typeof parsed?.dark !== 'number' || typeof parsed?.counts?.red !== 'number') {
      return { kind: 'absent', reason: 'unreadable' };
    }
    return { kind: 'present', snapshot: parsed };
  } catch {
    // ⛔ 못 읽은 것을 「이력 없음」으로 접지 않는다 — 사람이 고칠 대상이 다르다.
    return { kind: 'absent', reason: 'unreadable' };
  }
}

function defaultWriteSnapshot(snapshot: SweepSnapshot): void {
  const path = snapshotPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * 🕰️ 정기 전수 — 「어떤 변경으로도 안 닿는」 시험을 세고, 요청 시 돌려 «어제 값»과 나란히 낸다.
 *
 * ⛔ 이 명령은 ***관문이 아니다***(🅣 `A2` 정책 §2). 빨강이 있어도 exit 0 이다 —
 *   내 변경과 «무관»한 빨강으로 사람을 막으면, 그 관문은 「내 변경 탓」으로 오독된다.
 *   exit 1 은 ***스스로 못 쟀을 때***만이다(색인 실패 — 그것은 진짜 고장이다).
 */
export function runOrphanSweepCli(cwd: string, options: OrphanSweepOptions = {}, deps: OrphanSweepDeps = {}): OrphanSweepResult {
  const files = (deps.listFiles ?? defaultListFiles)(cwd);
  const tests = files.filter(isTestPath);
  const sources = files.filter((file) => SOURCE_RE.test(file) && !isTestPath(file));
  const exists = deps.exists ?? ((path) => existsSync(join(cwd, path)));
  const reachable = deriveRelatedTests(sources, exists);
  const index = (deps.buildIndex ?? buildImporterTestIndex)(cwd, tests, sources);
  const named = index === null ? null : [...new Set([...index.testsBySource.values()].flat())];
  const partition = partitionOrphanTests(tests, reachable, named);

  if ('indexUnavailable' in partition) {
    debug.log('gate.orphan-sweep', 'index-unavailable', { tests: tests.length, sources: sources.length });
    return { lines: [formatPartitionSummary(partition)], exitCode: 1 };
  }

  const lines = [formatPartitionSummary(partition)];
  debug.log('gate.orphan-sweep', 'partitioned', {
    tests: tests.length, sources: sources.length,
    reachable: partition.reachable, gateNamed: partition.gateNamed.length, dark: partition.dark.length,
  });

  if (!options.run) {
    lines.push(formatSweepNotRun(partition.dark.length));
    return { lines, exitCode: 0 };
  }

  const runTest = deps.runTest ?? defaultRunTest;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILE_TIMEOUT_MS;
  const verdicts = partition.dark.map((test) => runTest(cwd, test, timeoutMs));
  const counts = tallySweep(verdicts);
  const snapshot: SweepSnapshot = {
    at: (deps.now ?? (() => new Date()))().toISOString(),
    dark: partition.dark.length,
    counts,
    loadAverage: (deps.loadAverage ?? defaultLoadAverage)(),
  };
  const previous = (deps.readSnapshot ?? defaultReadSnapshot)();
  lines.push(formatSweepReport(snapshot, previous));
  // ⛔ 비교를 «낸 뒤에» 쓴다 — 먼저 쓰면 오늘 값이 자기 자신의 「어제」가 된다.
  (deps.writeSnapshot ?? defaultWriteSnapshot)(snapshot);
  // ⛔⭐ 🅣 계약은 「산출이 «목록»이 아니라 «수 ⊕ 어제 값»」이다 — 그건 ***사람이 읽는 줄***의 계약이다.
  //   ⚠️ 그런데 이름을 «아무 데도» 안 남기면 그 수가 ***행동으로 안 이어진다***(「18」을 보고 무엇을 할까).
  //   ⇒ 줄은 수로 두고, ***이름은 관측으로*** 꺼낸다 — 이 저장소의 1급 관측 CLI 가 그 관이다.
  //      monad logs --category gate.orphan-sweep --event swept --json --json-data
  debug.log('gate.orphan-sweep', 'swept', {
    ...counts, dark: snapshot.dark,
    previousRed: previous.kind === 'present' ? previous.snapshot.counts.red : null,
    previousAbsentReason: previous.kind === 'absent' ? previous.reason : null,
    loadAverage: snapshot.loadAverage ?? null,
    previousLoadAverage: previous.kind === 'present' ? previous.snapshot.loadAverage ?? null : null,
    redFiles: partition.dark.filter((_, index) => verdicts[index] === 'red'),
    timeoutFiles: partition.dark.filter((_, index) => verdicts[index] === 'timeout'),
  }, {
    // ⛔⭐ 기본 압축은 배열을 ***6에서 자르고*** `{_more: N}` 만 남긴다(LLM 요청 바디용 기본값).
    //   📏 실측 2026-08-25: 그대로 두니 빨강 18 중 ***6개만*** 회수됐다 —
    //     「이름을 관측으로 꺼낸다」는 회수 경로가 ***1/3만 작동***했다.
    //   ⇒ 이 이벤트는 저빈도(전수 1회)라 «전량»을 남긴다. 그러지 않으면 수만 남고 행동이 안 나온다.
    compact: { arrayMax: 512, stringMax: 512 },
  });
  return { lines, exitCode: 0 };
}
