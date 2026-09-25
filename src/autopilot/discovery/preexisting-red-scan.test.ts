// Self-Evolution SE1 preexisting-red-scan 단위테스트 — 순수(무 fs/db/network).
import { describe, test, expect } from 'bun:test';
import { scanPreexistingRed, seedFromPreexistingRed, type PreexistingRedScanResult } from './preexisting-red-scan.js';
import { planProposals } from './discovery-cycle.js';
import type { UnimplementedPlan } from './roadmap-scan.js';
import type { AbsorptionCandidate } from './ref-dig.js';
import type { PreexistingRedCandidate } from './preexisting-red-scan.js';

const uPlan = (over: Partial<UnimplementedPlan> = {}): UnimplementedPlan => ({
  path: 'docs/ROADMAP-memory.md', filename: 'ROADMAP-memory.md', topic: 'memory', date: '2026-07-01',
  openBoxes: 20, doneBoxes: 5, completionRatio: 0.2, staleScore: 20, priorityScore: 80, reasons: ['미완 20개'], ...over,
});
const aCand = (over: Partial<AbsorptionCandidate> = {}): AbsorptionCandidate => ({
  repoKey: 'codex', area: 'codex-rs/core', commits: 17, files: 55, whatChanged: ['feat: rollout budget'], score: 100, ...over,
});
const red = (file: string, contactCount: number): PreexistingRedCandidate => ({ file, contactCount });

const row = (...failures: Array<{ attribution: string; file?: string }>) => ({ failures });

describe('scanPreexistingRed', () => {
  test('introduced 만 가진 시험은 후보에 안 들어간다', () => {
    const candidates = scanPreexistingRed([
      row(
        { attribution: 'preexisting', file: 'src/a.test.ts' },
        { attribution: 'introduced', file: 'src/b.test.ts' },
      ),
      row({ attribution: 'introduced', file: 'src/c.test.ts' }),
    ]);
    expect(candidates.map(c => c.file)).toEqual(['src/a.test.ts']);
    expect(candidates.some(c => c.file === 'src/b.test.ts')).toBe(false);
    expect(candidates.some(c => c.file === 'src/c.test.ts')).toBe(false);
  });

  test('preexisting 항목을 가진 행 → 그 시험 파일이 후보에 들어간다', () => {
    const candidates = scanPreexistingRed([
      row({ attribution: 'preexisting', file: 'src/self-dev/launch-preflight.test.ts' }),
    ]);
    expect(candidates).toEqual([{ file: 'src/self-dev/launch-preflight.test.ts', contactCount: 1 }]);
  });

  test('같은 시험 파일이 세 행에서 preexisting → 접촉 빈도 3, 후보 하나', () => {
    const file = 'src/foo.test.ts';
    const candidates = scanPreexistingRed([
      row({ attribution: 'preexisting', file }),
      row({ attribution: 'preexisting', file }),
      row({ attribution: 'preexisting', file }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({ file, contactCount: 3 });
  });

  test('행 0개 → 빈 목록, 예외 없음', () => {
    expect(scanPreexistingRed([])).toEqual([]);
  });

  test('접촉 빈도 내림차순', () => {
    const candidates = scanPreexistingRed([
      row({ attribution: 'preexisting', file: 'src/low.test.ts' }),
      row({ attribution: 'preexisting', file: 'src/high.test.ts' }),
      row({ attribution: 'preexisting', file: 'src/high.test.ts' }),
    ]);
    expect(candidates.map(c => c.file)).toEqual(['src/high.test.ts', 'src/low.test.ts']);
    expect(candidates[0]!.contactCount).toBe(2);
  });
});

describe('seedFromPreexistingRed', () => {
  test('후보 하나 → ProposalSeed source=preexisting-red', () => {
    const seed = seedFromPreexistingRed({ file: 'src/foo.test.ts', contactCount: 3 });
    expect(seed.source).toBe('preexisting-red');
    expect(seed.evidence).toContain('src/foo.test.ts');
    expect(seed.title).toContain('src/foo.test.ts');
    expect(seed.slug.length).toBeGreaterThan(0);
  });
});

describe('planProposals — preexisting 빨강 입력원', () => {
  test('빨강 후보 5개 · 상한 2 → 빨강 seed 정확히 2개', () => {
    const plans = planProposals({
      unimplemented: [],
      absorption: [],
      preexistingRed: [red('a.test.ts', 5), red('b.test.ts', 4), red('c.test.ts', 3), red('d.test.ts', 2), red('e.test.ts', 1)],
      preexistingRedCap: 2,
    });
    expect(plans.filter(p => p.seed.source === 'preexisting-red')).toHaveLength(2);
    expect(plans).toHaveLength(2);
  });

  test('빨강 입력을 비우면 기존 두 입력원 산출(rank 포함)이 그대로다', () => {
    const base = {
      unimplemented: [uPlan({ topic: 'a' }), uPlan({ topic: 'b' }), uPlan({ topic: 'c' }), uPlan({ topic: 'd' })],
      absorption: [aCand({ area: 'x' }), aCand({ area: 'y' }), aCand({ area: 'z' })],
      internalCap: 2,
      externalCap: 1,
    };
    const without = planProposals(base);
    const empty = planProposals({ ...base, preexistingRed: [] });
    expect(empty).toEqual(without);
    expect(without.map(p => ({ source: p.seed.source, rank: p.rank }))).toEqual([
      { source: 'internal-roadmap', rank: 1 },
      { source: 'internal-roadmap', rank: 2 },
      { source: 'external-repo', rank: 3 },
    ]);
  });
});

const FILE_A = 'src/a.test.ts';
const FILE_B = 'src/b.test.ts';
const FILE_C = 'src/c.test.ts';
const FILE_D = 'src/d.test.ts';
const T0 = 1_000;
const T1 = 2_000;

const preexisting = (file: string) => ({ attribution: 'preexisting' as const, file });
const introduced = (file: string) => ({ attribution: 'introduced' as const, file });

const timed = (over: {
  ts: number;
  baselineStatus?: string;
  baselineFiles?: string[];
  failures?: Array<{ attribution: string; file?: string }>;
}) => ({
  ts: over.ts,
  baselineStatus: over.baselineStatus,
  baselineFiles: over.baselineFiles ?? [],
  failures: over.failures ?? [],
});

const scan = (observations: readonly unknown[]): PreexistingRedScanResult =>
  scanPreexistingRed(observations) as PreexistingRedScanResult;

describe('scanPreexistingRed — 만료', () => {
  test('파일 A 가 옛 행에서 preexisting 이고 더 최신 행에서 baselineStatus 가 pass 다 → A 가 후보에 없다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_A],
        failures: [preexisting(FILE_A)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'pass',
        baselineFiles: [FILE_A],
      }),
    ]);
    expect(result.map(c => c.file)).not.toContain(FILE_A);
  });

  test('파일 B 가 옛 행에서 preexisting 이고 더 최신 행에서도 preexisting 이다 → B 가 후보에 있다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_B],
        failures: [preexisting(FILE_B)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_B],
        failures: [preexisting(FILE_B)],
      }),
    ]);
    expect(result.map(c => c.file)).toContain(FILE_B);
  });

  test('파일 C 가 옛 행에서 preexisting 인데 더 최신 행은 C 를 담았으나 preexisting 목록에 C 가 없다 → C 가 후보에 없다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_C],
        failures: [preexisting(FILE_C)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_C],
        failures: [introduced(FILE_C)],
      }),
    ]);
    expect(result.map(c => c.file)).not.toContain(FILE_C);
  });

  test('파일 D 가 옛 행에서 preexisting 이고 그 뒤 어떤 행도 D 를 담지 않는다 → 잔여 수가 1 이고 D 는 후보에 남는다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_D],
        failures: [preexisting(FILE_D)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'pass',
        baselineFiles: [FILE_A],
      }),
    ]);
    expect(result.residual).toBe(1);
    expect(result.map(c => c.file)).toContain(FILE_D);
  });

  test('위 넷을 한꺼번에 준다 → 본 수가 4 이고 뺀 수가 2 이고 남은 수가 2 다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_A, FILE_B, FILE_C, FILE_D],
        failures: [preexisting(FILE_A), preexisting(FILE_B), preexisting(FILE_C), preexisting(FILE_D)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_B, FILE_C],
        failures: [preexisting(FILE_B), introduced(FILE_C)],
      }),
      timed({
        ts: T1 + 1,
        baselineStatus: 'pass',
        baselineFiles: [FILE_A],
      }),
    ]);
    expect(result.seen).toBe(4);
    expect(result.subtracted).toBe(2);
    expect(result.remaining).toBe(2);
    expect(result.map(c => c.file).sort()).toEqual([FILE_B, FILE_D]);
    expect(result.residual).toBe(1);
  });

  test('시각이 하나도 없는 행만 준다 → 만료가 하나도 일어나지 않고 이전과 같은 목록이 나온다', () => {
    const observations = [
      row(preexisting(FILE_A), preexisting(FILE_C)),
      row(preexisting(FILE_B)),
      row(preexisting(FILE_B)),
    ];
    const result = scan(observations);
    expect(result.map(c => ({ file: c.file, contactCount: c.contactCount }))).toEqual([
      { file: FILE_B, contactCount: 2 },
      { file: FILE_A, contactCount: 1 },
      { file: FILE_C, contactCount: 1 },
    ]);
    expect(result.subtracted).toBe(0);
    expect(result.residual).toBe(0);
    expect(result.lastObservedAtMsByFile).toEqual({});
  });

  test('파일마다 마지막 관측 시각을 묻는다 → lastObservedAtMsByFile 에 각 파일의 가장 큰 시각이 들어 있다', () => {
    const result = scan([
      timed({
        ts: T0,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_A, FILE_B],
        failures: [preexisting(FILE_A), preexisting(FILE_B)],
      }),
      timed({
        ts: T1,
        baselineStatus: 'test-fail',
        baselineFiles: [FILE_A],
        failures: [preexisting(FILE_A)],
      }),
    ]);
    expect(result.lastObservedAtMsByFile[FILE_A]).toBe(T1);
    expect(result.lastObservedAtMsByFile[FILE_B]).toBe(T0);
  });

  test('행을 0개 준다 → 빈 후보 목록이고 본 수가 0이고 잔여 수가 0이고 예외를 던지지 않는다', () => {
    const result = scan([]);
    expect([...result]).toEqual([]);
    expect(result.seen).toBe(0);
    expect(result.residual).toBe(0);
    expect(result.subtracted).toBe(0);
    expect(result.remaining).toBe(0);
  });
});
