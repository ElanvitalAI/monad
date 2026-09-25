import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLockAsync } from '../../src/storage/file-lock.js';
import { fillUnverifiableGoalSlots } from '../../src/self-implement/goal-supervisor-fill.js';

import { debug } from '../../src/debug/log';
import { SCHEDULER_LOG_CATEGORY } from '../../src/dispatch/continuation-scheduler';
import { INACTIVE_AUTO_MODE_STATE } from '../../src/auto-research/auto-mode/types';
import {
  AuthoredGoalQueueDuplicateIdError,
  AuthoredGoalQueueLockTimeoutError,
  authoredGoalQueueLockPath,
  authoredGoalQueuePath,
  authoredGoalQueueQuarantinePath,
  authoredGoalSlugFromFile,
  completeAuthoredGoal,
  createActiveGoalReader,
  enqueueAuthoredGoal,
  getActiveGoalFromSources,
  isAuthoredGoalTerminalOutcome,
  readAuthoredGoalQueue,
  readAuthoredGoalDocument,
  readNextAuthoredGoal,
} from '../../src/dispatch/authored-goal-queue';

const rule = { kind: 'custom' as const, command: 'test -f DONE', timeoutMs: 5000 };

function fixture(): { root: string; stateRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'authored-goal-queue-'));
  mkdirSync(join(root, 'docs', 'goals'), { recursive: true });
  writeFileSync(join(root, 'docs', 'goals', 'GOAL-first.md'), 'first');
  writeFileSync(join(root, 'docs', 'goals', 'GOAL-second.md'), 'second');
  return { root, stateRoot: join(root, 'state') };
}

function persistedEntry(terminationRule: unknown, overrides: Record<string, unknown> = {}) {
  return { id: 'x', goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule, ...overrides };
}

function writePersistentQueue(stateRoot: string, state: unknown): void {
  mkdirSync(join(stateRoot, 'dispatch'), { recursive: true });
  writeFileSync(join(stateRoot, 'dispatch', 'authored-goal-queue.json'), JSON.stringify(state));
}

describe('authored goal queue', () => {
  // 반증 입력 — 파일명을 그대로 slug 로 쓰면 `GOAL-` 접두의 대문자에서 규칙(^[a-z0-9][a-z0-9_-]*$)이
  //   깨진다. 라이브로 `invalid authored goal queue entry` 를 받고 나서야 알았다.
  test('derives a queue slug that satisfies the entry rule', () => {
    expect(authoredGoalSlugFromFile('docs/goals/GOAL-Test-Goal-11ab6345-2026-08-01.md')).toBe('test-goal-11ab6345-2026-08-01');
    expect(authoredGoalSlugFromFile('docs/goals/GOAL-한글-x9.md')).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(authoredGoalSlugFromFile('docs/goals/GOAL-2026-first.md')).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  test('accepts only Markdown goal files and rejects the retired .txt contract', async () => {
    const { root, stateRoot } = fixture();
    try {
      await expect(enqueueAuthoredGoal({
        goalSlug: 'legacy',
        goalFile: 'docs/goals/GOAL-first.txt',
        terminationRule: rule,
      }, { repositoryRoot: root, stateRoot })).rejects.toThrow('direct docs/goals/GOAL-*.md');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('retains an unverifiable authored goal in the persisted queue', async () => {
    const { root, stateRoot } = fixture();
    const goalFile = 'docs/goals/GOAL-first.md';
    const path = join(root, goalFile);
    writeFileSync(path, 'Goal\n\n## 불변식\n- UNVERIFIABLE\n\n## 판정 신호\n- UNVERIFIABLE\n');
    try {
      const queued = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile, terminationRule: rule }, { repositoryRoot: root, stateRoot });
      expect(await fillUnverifiableGoalSlots({ path, round: 1, gate: { passed: false }, independentlyCheck: async () => true })).toBe('unverifiable');
      expect(readFileSync(path, 'utf8')).toContain('UNVERIFIABLE');
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe(queued.id);
      expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.id)).toEqual([queued.id]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('is empty by default and never scans docs/goals', async () => {
    const { root, stateRoot } = fixture();
    try {
      expect(await readNextAuthoredGoal(stateRoot, root)).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('selects auto-mode before the persisted queue and otherwise returns only the queue head', async () => {
    const { root, stateRoot } = fixture();
    try {
      const first = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      await enqueueAuthoredGoal({ goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      const queued = await readNextAuthoredGoal(stateRoot, root);

      expect(await getActiveGoalFromSources(INACTIVE_AUTO_MODE_STATE, () => null)).toBeNull();
      expect(await getActiveGoalFromSources(INACTIVE_AUTO_MODE_STATE, () => queued)).toEqual({ goalSlug: 'first', id: first.id, source: 'file-queue' });
      // ⛔ 반증 입력 — auto-mode 가 우선하면 큐 reader 가 **호출조차 안 된다**(리뷰 must-fix:
      //   인자로 받으면 호출부에서 평가돼 큐를 읽고 격리 파일까지 쓸 수 있었다).
      let queueReads = 0;
      expect(await getActiveGoalFromSources(
        { ...INACTIVE_AUTO_MODE_STATE, active: true, goalSlug: 'auto', terminationRule: rule },
        () => { queueReads += 1; return queued; },
      )).toEqual({ goalSlug: 'auto', source: 'auto-mode' });
      expect(queueReads).toBe(0);
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe(first.id);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // ⛔ 위 테스트는 **helper 만** 본다. 실제 위반은 helper 밖(nexus 클로저)에 있었고 — 자기수복 드레인이
  //   auto-mode 확인 **앞**에서 `completeAuthoredGoal`(잠금 아래 mutation)을 돌렸다 — 그래서 위 테스트가
  //   초록인 채로 *"auto-mode 활성 시 큐 무접촉"* 이 깨져 있었다(7차 리뷰 must-fix).
  //   ⇒ 이 테스트는 **생산 경로 그 자체**(`createActiveGoalReader`)에서 큐 함수 호출 0회를 센다.
  test('production getActiveGoal touches the queue zero times while auto-mode is active', async () => {
    let queueReads = 0;
    let completions = 0;
    // 드레인 대상이 **남아 있는** 상태로 둔다 — 비어 있으면 순서 결함이 드러나지 않는다.
    const pendingCompletions = new Set<string>(['stuck-id']);
    const read = createActiveGoalReader({
      getAutoModeState: () => ({ ...INACTIVE_AUTO_MODE_STATE, active: true, goalSlug: 'auto', terminationRule: rule }),
      readNextAuthoredGoal: () => { queueReads += 1; return null; },
      completeAuthoredGoal: async () => { completions += 1; return true; },
      pendingCompletions,
      onError: () => { throw new Error('unexpected error path'); },
    });

    expect(await read()).toEqual({ goalSlug: 'auto', source: 'auto-mode' });
    expect(queueReads).toBe(0);
    expect(completions).toBe(0);
    expect([...pendingCompletions]).toEqual(['stuck-id']);
  });

  test('production getActiveGoal drains pending completions once auto-mode is inactive', async () => {
    let queueReads = 0;
    const drained: string[] = [];
    const pendingCompletions = new Set<string>(['stuck-id']);
    const read = createActiveGoalReader({
      getAutoModeState: () => INACTIVE_AUTO_MODE_STATE,
      readNextAuthoredGoal: () => { queueReads += 1; return null; },
      completeAuthoredGoal: async (id) => { drained.push(id); return true; },
      pendingCompletions,
      onError: () => { throw new Error('unexpected error path'); },
    });

    expect(await read()).toBeNull();
    expect(drained).toEqual(['stuck-id']);
    expect(pendingCompletions.size).toBe(0);
    expect(queueReads).toBe(1);
  });

  // 드레인이 실패하면 목록에 남아 다음 틱이 다시 시도한다 — 큐 선두 영구 정지 방지.
  test('production getActiveGoal keeps a failed completion for the next tick and fails closed on error', async () => {
    const pendingCompletions = new Set<string>(['stuck-id']);
    const keep = createActiveGoalReader({
      getAutoModeState: () => INACTIVE_AUTO_MODE_STATE,
      readNextAuthoredGoal: () => null,
      completeAuthoredGoal: async () => false,
      pendingCompletions,
      onError: () => { throw new Error('unexpected error path'); },
    });
    expect(await keep()).toBeNull();
    expect([...pendingCompletions]).toEqual(['stuck-id']);

    const errors: unknown[] = [];
    const failing = createActiveGoalReader({
      getAutoModeState: () => INACTIVE_AUTO_MODE_STATE,
      readNextAuthoredGoal: () => { throw new Error('lock timeout'); },
      completeAuthoredGoal: async () => true,
      pendingCompletions: new Set<string>(),
      onError: (error) => errors.push(error),
    });
    expect(await failing()).toBeNull();
    expect(errors).toHaveLength(1);
  });

  // ⛔ 리뷰가 두 라운드에 걸쳐 든 반증 시나리오를 **그대로** 고정한다: *"읽을 수 없는 선두와 **같은 ID**의
  //   후속 골이 선택되면 완료가 다른 항목을 지운다"*. 그 기전(ID 로 큐 전체를 뒤지는 탐색)은 현재 코드에
  //   없지만 — `completeAuthoredGoal` 은 **선두만** 보고 id 가 같을 때만 옮긴다 — 계약이므로 못 박는다.
  test('a duplicate id behind an unreadable head can never complete the wrong entry', async () => {
    const { root, stateRoot } = fixture();
    try {
      const unreadableHead = persistedEntry(rule, { id: 'dup', goalFile: 'docs/goals/GOAL-missing.md' });
      const sameIdFollower = persistedEntry(rule, { id: 'dup', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md' });
      writePersistentQueue(stateRoot, { pending: [unreadableHead, sameIdFollower], completed: [] });

      // ① 읽는 자리에서 **뒤에 온 중복이 걸러진다** — 후속 골이 선두로 오인될 자리가 애초에 없다.
      expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.goalFile))
        .toEqual(['docs/goals/GOAL-missing.md']);

      // ② 선두가 읽히지 않으므로 실행 대상이 나오지 않는다(빈 골로 도는 일이 없다).
      expect(await readNextAuthoredGoal(stateRoot, root)).toBeNull();

      // ③ ⭐ 핵심 — 그 id 로 완료를 시도해도 **후속 골이 완료되지 않는다**.
      //    완료는 선두만 보므로, 지워진 중복이 completed 로 새어 들어갈 경로가 없다.
      await completeAuthoredGoal('dup', stateRoot);
      expect(readAuthoredGoalQueue(stateRoot).completed.map((entry) => entry.goalFile))
        .not.toContain('docs/goals/GOAL-second.md');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // ⛔⭐ **라이브 폐루프가 잡은 것**(2026-08-01) — 단위 테스트는 전부 초록이었는데, 격리 인스턴스에서
  //   실제로 돌리자 저작한 골이 **큐에서 사라졌다**(`queue-entry-quarantined … (missing)`).
  //   원인은 뿌리 불일치였고, 결함은 **환경적 실패를 구조적 실패와 같은 운명으로 묶은 것**이었다.
  test('an unreadable goal file keeps its place in the queue instead of being destroyed', async () => {
    const { root, stateRoot } = fixture();
    try {
      const entry = persistedEntry(rule, { id: 'not-here', goalFile: 'docs/goals/GOAL-absent.md' });
      const follower = persistedEntry(rule, { id: 'later', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md' });
      writePersistentQueue(stateRoot, { pending: [entry, follower], completed: [] });

      // 이번 틱은 골이 없다 — 그러나 **버리지 않는다**.
      expect(await readNextAuthoredGoal(stateRoot, root)).toBeNull();
      expect(readAuthoredGoalQueue(stateRoot).pending.map((e) => e.id)).toEqual(['not-here', 'later']);
      expect(existsSync(authoredGoalQueueQuarantinePath(stateRoot))).toBe(false);

      // ⭐ 파일이 나타나면 **같은 골이 그대로 실행된다**(뿌리가 어긋났다 복구된 경우).
      writeFileSync(join(root, 'docs', 'goals', 'GOAL-absent.md'), 'now present');
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('not-here');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // 대조군 — **구조적** 결함은 기다려도 유효해지지 않으므로 종전대로 격리하고 버린다.
  test('a structurally invalid head is still quarantined and dropped', async () => {
    const { root, stateRoot } = fixture();
    try {
      const escaping = persistedEntry(rule, { id: 'bad', goalFile: 'docs/goals/../GOAL-first.md' });
      const follower = persistedEntry(rule, { id: 'good', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md' });
      writePersistentQueue(stateRoot, { pending: [escaping, follower], completed: [] });

      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('good');
      expect(readAuthoredGoalQueue(stateRoot).pending.map((e) => e.id)).toEqual(['good']);
      expect(existsSync(authoredGoalQueueQuarantinePath(stateRoot))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('persists explicit FIFO entries and advances after terminal completion', async () => {
    const { root, stateRoot } = fixture();
    try {
      const first = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      await enqueueAuthoredGoal({ goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      expect((await readNextAuthoredGoal(stateRoot, root))?.goalSlug).toBe('first');
      expect(await completeAuthoredGoal(first.id, stateRoot)).toBe(true);
      expect((await readNextAuthoredGoal(stateRoot, root))?.goalSlug).toBe('second');
      expect(readAuthoredGoalQueue(stateRoot).completed.map((entry) => entry.goalSlug)).toEqual(['first']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('serializes concurrent enqueue and completion mutations without losing either update', async () => {
    const { root, stateRoot } = fixture();
    try {
      const first = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      await Promise.all([
        completeAuthoredGoal(first.id, stateRoot),
        enqueueAuthoredGoal({ goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot }),
      ]);
      const state = readAuthoredGoalQueue(stateRoot);
      expect(state.pending.map((entry) => entry.goalSlug)).toEqual(['second']);
      expect(state.completed.map((entry) => entry.goalSlug)).toEqual(['first']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('concurrent first creation on an absent queue file preserves both mutations', async () => {
    const { root, stateRoot } = fixture();
    try {
      // No queue file exists yet: both enqueues race the very first
      // creation. If initialization happened outside the lock, the later
      // empty-queue write would clobber the earlier locked mutation and
      // one entry would be lost.
      expect(existsSync(authoredGoalQueuePath(stateRoot))).toBe(false);
      await Promise.all([
        enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot }),
        enqueueAuthoredGoal({ goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot }),
      ]);
      const slugs = readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.goalSlug).sort();
      expect(slugs).toEqual(['first', 'second']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects a caller-supplied id that duplicates a pending or completed entry', async () => {
    const { root, stateRoot } = fixture();
    try {
      const first = await enqueueAuthoredGoal({ id: 'dup', goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      await expect(enqueueAuthoredGoal({ id: 'dup', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot }))
        .rejects.toBeInstanceOf(AuthoredGoalQueueDuplicateIdError);
      expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.goalSlug)).toEqual(['first']);
      expect(await completeAuthoredGoal(first.id, stateRoot)).toBe(true);
      // Still rejected once the id has moved to completed.
      await expect(enqueueAuthoredGoal({ id: 'dup', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot }))
        .rejects.toBeInstanceOf(AuthoredGoalQueueDuplicateIdError);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // 반증 입력 — enqueue 경로가 아니라 **이미 중복된 영속 파일**을 읽는 경우다(리뷰 must-fix).
  //   중복이 남으면 같은 id 의 후속 항목이 선두로 오인돼 큐가 영구 정지한다.
  test('quarantines a duplicate id that already exists in the persisted file', async () => {
    const { root, stateRoot } = fixture();
    try {
      const entry = { id: 'dup', goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule };
      writePersistentQueue(stateRoot, { pending: [entry, { ...entry, goalSlug: 'second' }], completed: [] });

      // 읽기 전용 호출은 격리 기록을 **안 남긴다**(레코드 누적 방지) — 걸러내기만 한다.
      expect(readAuthoredGoalQueue(stateRoot).pending.map((e) => e.goalSlug)).toEqual(['first']);
      expect(existsSync(authoredGoalQueueQuarantinePath(stateRoot))).toBe(false);
      // 변경 경로(readNextAuthoredGoal → mutateQueue)에서는 남는다.
      expect((await readNextAuthoredGoal(stateRoot, root))?.goalSlug).toBe('first');
      expect(readFileSync(authoredGoalQueueQuarantinePath(stateRoot), 'utf8')).toContain('duplicate id');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('times out without compromising a live advisory lease lock', async () => {
    const { root, stateRoot } = fixture();
    let release: (() => Promise<void>) | undefined;
    try {
      const lockPath = authoredGoalQueueLockPath(stateRoot);
      mkdirSync(join(stateRoot, 'dispatch'), { recursive: true });
      writePersistentQueue(stateRoot, { pending: [], completed: [] });
      // ⭐ 저장소의 async 권고 리스로 잠근다 — 새 의존성을 쓰지 않는다(리뷰 must-fix).
      const held = await acquireLockAsync(lockPath, { staleMs: 2_000 });
      release = async () => { held.release(); };
      await expect(enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot })).rejects.toBeInstanceOf(AuthoredGoalQueueLockTimeoutError);
      // 반증 입력: 시간초과가 **남의 리스를 깨지 않았다** — 잠금 파일이 그대로 있다.
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      await release?.();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('completes only the matching queue head and preserves FIFO for a rejected follower completion', async () => {
    const { root, stateRoot } = fixture();
    try {
      const first = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      const second = await enqueueAuthoredGoal({ goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      expect(await completeAuthoredGoal(second.id, stateRoot)).toBe(false);
      expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.id)).toEqual([first.id, second.id]);
      expect(await completeAuthoredGoal(first.id, stateRoot)).toBe(true);
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe(second.id);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('restores the queued document after restart and rejects traversal', async () => {
    const { root, stateRoot } = fixture();
    try {
      const entry = await enqueueAuthoredGoal({ goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      expect(readAuthoredGoalDocument((await readNextAuthoredGoal(stateRoot, root))!, root)).toBe('first');
      expect(entry.id).toBeString();
      // ⛔ enqueueAuthoredGoal 은 async 다 — `expect(() => …).toThrow()` 는 **거부를 검사하지 않는다**
      //   (Promise 를 만들고 끝난다). rejects 로 실제 거부를 본다(리뷰 must-fix).
      await expect(enqueueAuthoredGoal({ goalSlug: 'escape', goalFile: 'docs/goals/../GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot })).rejects.toThrow('direct docs/goals/GOAL-*.md');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // ⛔ 위 mutation 경로 테스트는 이 결함을 **못 잡는다** — `readNextAuthoredGoal` 은 정제 결과를 곧바로
  //   저장해서 두 번째 호출에는 손상이 남아 있지 않다. 실제 누수는 **읽기 전용 기본값**에 있었다:
  //   nexus 가 매 틱 `readAuthoredGoalQueue()`(quarantine=false)를 부르는데 항목별 격리가 플래그를
  //   무시해 같은 손상마다 JSONL 이 무한히 늘었다(7차 리뷰 must-fix).
  test('read-only queue reads never write quarantine records no matter how many ticks', () => {
    const { root, stateRoot } = fixture();
    const records: Array<{ event: string }> = [];
    const off = debug.registerSink({
      name: 'authored-goal-queue-readonly-test',
      emit: (record) => {
        if (record.category === SCHEDULER_LOG_CATEGORY) records.push({ event: record.event });
      },
    });
    try {
      const invalid = persistedEntry(rule, { id: 'invalid', goalFile: 42 });
      const valid = persistedEntry(rule, { id: 'valid', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md' });
      writePersistentQueue(stateRoot, { pending: [invalid, valid], completed: [] });

      for (let tick = 0; tick < 5; tick += 1) {
        // 손상 항목은 걸러지되(선두는 valid) 격리는 **한 줄도** 안 쌓인다.
        expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.id)).toEqual(['valid']);
      }
      expect(records.filter((record) => record.event === 'queue-entry-quarantined')).toHaveLength(0);
      expect(existsSync(authoredGoalQueueQuarantinePath(stateRoot))).toBe(false);
      // 관측은 남는다 — 조용히 버리는 것이 아니라 매 틱 볼 수 있다.
      expect(records.filter((record) => record.event === 'queue-entry-invalid')).toHaveLength(5);
    } finally {
      off();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('quarantines a malformed persisted head and preserves the valid follower through mutation', async () => {
    const { root, stateRoot } = fixture();
    const records: Array<{ event: string; data: unknown }> = [];
    const off = debug.registerSink({
      name: 'authored-goal-queue-quarantine-test',
      emit: (record) => {
        if (record.category === SCHEDULER_LOG_CATEGORY) records.push({ event: record.event, data: record.data });
      },
    });
    try {
      const invalid = persistedEntry(rule, { id: 'invalid', goalFile: 42 });
      const valid = persistedEntry(rule, { id: 'valid', goalSlug: 'second', goalFile: 'docs/goals/GOAL-second.md' });
      writePersistentQueue(stateRoot, { pending: [invalid, valid], completed: [] });

      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('valid');
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('valid');
      expect(records.filter((record) => record.event === 'queue-entry-quarantined')).toHaveLength(1);
      const quarantined = readFileSync(authoredGoalQueueQuarantinePath(stateRoot), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(quarantined).toHaveLength(1);
      expect(quarantined.some((record) => record.reason === 'goalFile must be a string' && record.entry.goalFile === 42)).toBe(true);

      await enqueueAuthoredGoal({ id: 'third', goalSlug: 'first', goalFile: 'docs/goals/GOAL-first.md', terminationRule: rule }, { repositoryRoot: root, stateRoot });
      expect(readAuthoredGoalQueue(stateRoot).pending.map((entry) => entry.id)).toEqual(['valid', 'third']);
      expect(await completeAuthoredGoal('valid', stateRoot)).toBe(true);
      expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('third');
    } finally {
      off();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('allows only explicit terminal driver outcomes to complete queue work', () => {
    expect(isAuthoredGoalTerminalOutcome('complete')).toBe(true);
    expect(isAuthoredGoalTerminalOutcome('budget')).toBe(true);
    expect(isAuthoredGoalTerminalOutcome('max_turns')).toBe(true);
    expect(isAuthoredGoalTerminalOutcome('andon-no-progress')).toBe(true);
    expect(isAuthoredGoalTerminalOutcome('continued')).toBe(false);
    expect(isAuthoredGoalTerminalOutcome('inactive')).toBe(false);
  });

  test('safely rejects persisted entries with malformed termination rules', async () => {
    const { root, stateRoot } = fixture();
    try {
      for (const terminationRule of [
        { kind: 'min_sources', n: -1, sourcesPath: 'sources.md' },
        { kind: 'min_sources', n: 1.5, sourcesPath: 'sources.md' },
        { kind: 'budget_remaining_min', ratio: 1.01 },
        { kind: 'budget_remaining_min', ratio: -0.01 },
        { kind: 'summary_written', path: '', minChars: 0 },
        { kind: 'summary_written', path: 'summary.md', minChars: -1 },
        { kind: 'custom', command: '', timeoutMs: 1000 },
        { kind: 'custom', command: 'true', timeoutMs: -1 },
      ]) {
        writePersistentQueue(stateRoot, { pending: [persistedEntry(terminationRule)], completed: [] });
        expect(await readNextAuthoredGoal(stateRoot, root)).toBeNull();
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('restores every valid termination-rule variant from persistent state', async () => {
    const { root, stateRoot } = fixture();
    try {
      for (const terminationRule of [
        { kind: 'all_questions_answered', queuePath: 'questions.md' },
        { kind: 'min_sources', n: 1, sourcesPath: 'sources.md' },
        { kind: 'summary_written', path: 'summary.md', minChars: 0 },
        { kind: 'budget_remaining_min', ratio: 0 },
        { kind: 'budget_remaining_min', ratio: 1 },
        { kind: 'and', rules: [{ kind: 'custom', command: 'true' }] },
        { kind: 'or', rules: [{ kind: 'custom', command: 'true', timeoutMs: 1 }] },
        { kind: 'custom', command: 'true', timeoutMs: 1 },
      ]) {
        writePersistentQueue(stateRoot, { pending: [persistedEntry(terminationRule)], completed: [] });
        expect((await readNextAuthoredGoal(stateRoot, root))?.id).toBe('x');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
