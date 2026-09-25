import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { selfDevRunsDir } from '../self-dev/run-store.js';
import type { PtyManifestRow } from '../pty-shell/pty-manifest.js';
import { classifyPtyOwnerRunUsage, federatedPtyRefs, liveProcessStartedAt, ptyListRunTermination, ptyProcessStartEnv, resolveRunTermination, runPtyList, type PtyTakeoverCommandDeps, type RunTermination } from './pty-takeover-cli.js';

test('alive manifest row with a dead owner process is not listed as alive', () => {
  const listing = federatedPtyRefs(
    [{ name: 'test:monad-agent', dbPath: '/test/pty/manifest.db' }],
    () => [{ id: 'pty_ghost', kind: 'shell', alive: true, ownerPid: 999_999 }],
    () => false,
  );

  expect(listing).toEqual({ refs: [], unreadable: [] });
});

test('federated listing carries the observed owner liveness into the production row', () => {
  const listing = federatedPtyRefs(
    [{ name: 'test:monad-agent', dbPath: '/test/pty/manifest.db' }],
    () => [{ id: 'pty_live', kind: 'shell', alive: true, ownerPid: 123, runId: 'run-federated' }],
    (pid) => pid === 123,
  );

  expect(listing.refs).toEqual([{
    instance: 'test:monad-agent', id: 'pty_live', kind: 'shell', alive: true,
    ownerProcessAlive: true, runId: 'run-federated', sourceRoot: '/test/pty/manifest.db',
  }]);
});

test('run termination uses the first federated ledger containing the run', () => {
  const loads: string[] = [];
  const load = (_runId: string, directory: string) => {
    loads.push(directory);
    if (directory === '/second/run-ledger') return [{ runId: 'run-123', event: 'run-status', data: { runStatus: 'completed' } }];
    return null;
  };

  expect(resolveRunTermination('run-123', ['/first/run-ledger', '/second/run-ledger'], load)).toBe(true);
  expect(loads).toEqual(['/first/run-ledger', '/second/run-ledger']);
});

test('pty list JSON emits the federated termination result without changing the table path', () => {
  const row: PtyManifestRow = {
    id: 'pty_federated', kind: 'pty', cmd: 'bun', ownerPid: 1, ptyPid: 1, instance: 'test', startedAt: 0, alive: true,
    exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0, outputBytesTotal: 0,
    runId: 'run-123', runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentKind: '', parentPid: 0, closedAt: 0, codeSha: '',
  };
  const deps: PtyTakeoverCommandDeps = {
    currentManifestDbPath: () => '/test/pty/manifest.db',
    manifestTargets: () => [{ name: 'test', dbPath: '/test/pty/manifest.db' }],
    listManifestRowsAt: () => [row],
    isProcessAlive: () => true,
    getPty: () => { throw new Error('unexpected getPty'); },
    requestPtyTakeover: () => { throw new Error('unexpected requestPtyTakeover'); },
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: () => {},
    runTerminated: (runId) => resolveRunTermination(runId, ['/first/run-ledger', '/second/run-ledger'], (_id, directory) => directory === '/second/run-ledger'
      ? [{ runId: 'run-123', event: 'run-status', data: { runStatus: 'running' } }]
      : null),
  };

  const result = JSON.parse(runPtyList(deps, { json: true }).message)[0];
  expect(result.runTerminated).toBe(false);
  expect(result.ownerRunUsage).toBe('running');
});

test('pty list JSON distinguishes ledger and run-store termination attribution', () => {
  const row = (id: string, runId: string): PtyManifestRow => ({
    id, kind: 'pty', cmd: 'bun', ownerPid: 1, ptyPid: 1, instance: 'test', startedAt: 0, alive: true,
    exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0, outputBytesTotal: 0,
    runId, runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentKind: '', parentPid: 0, closedAt: 0, codeSha: '',
  });
  const deps: PtyTakeoverCommandDeps = {
    currentManifestDbPath: () => '/test/pty/manifest.db', manifestTargets: () => [{ name: 'test', dbPath: '/test/pty/manifest.db' }],
    listManifestRowsAt: () => [row('pty-ledger', 'run-ledger'), row('pty-store', 'run-store')], isProcessAlive: () => true,
    getPty: () => undefined, requestPtyTakeover: () => false, requestRemote: async () => ({ status: 'unknown-pty' }), log: () => {},
    runTerminationResolution: (runId) => runId === 'run-ledger'
      ? { termination: true, source: 'ledger', runStoreIo: 'not-checked' }
      : { termination: false, source: 'run-store', runStoreIo: 'live' },
  };
  const rows = JSON.parse(runPtyList(deps, { json: true }).message);
  expect(rows.map((item: { runTerminated: boolean; runTerminationSource: string; runStoreIo: string }) => [item.runTerminated, item.runTerminationSource, item.runStoreIo])).toEqual([
    [true, 'ledger', 'not-checked'], [false, 'run-store', 'live'],
  ]);
});

test('run-store fallback preserves ledger priority and distinguishes every checkpoint boundary', () => {
  const ledgers = ['/first/run-ledger', '/second/run-ledger'];
  const checkpoint = (overrides: Record<string, unknown> = {}) => JSON.stringify({ runId: 'run-store', createdAt: 1_000, updatedAt: 1_000, results: [], pid: 7, ...overrides });
  const resolve = (load: (runId: string, directory: string) => readonly never[] | null, read: (path: string) => string, alive = () => true, startedAt: () => number | null = () => -1_000) =>   // ⭐ 기본은 «확실히 앞»: [-1000, 0) 구간이 createdAt(1000) 을 안 가로지른다
    ptyListRunTermination('run-store', ledgers, load, read, alive, startedAt);

  expect(resolve(() => [{ runId: 'run-store', event: 'run-status', data: { runStatus: 'completed' } }] as never, () => { throw new Error('run store must not be read when ledger answers'); })).toEqual({ termination: true, source: 'ledger', runStoreIo: 'not-checked' });
  expect(resolve(() => null, () => checkpoint())).toEqual({ termination: false, source: 'run-store', runStoreIo: 'live' });
  expect(resolve(() => null, (path) => { const error = new Error(path) as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error; })).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'not-found' });
  expect(resolve(() => null, () => { throw new Error('denied'); })).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'read-failed' });
  expect(resolve(() => null, () => '{invalid-json')).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'incomplete' });
  for (const pid of [undefined, 1.5, Infinity]) {
    expect(resolve(() => null, () => checkpoint({ pid }))).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'incomplete' });
  }
  expect(ptyListRunTermination('../outside', ledgers, () => null, () => { throw new Error('unsafe run ID must not be read'); })).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'incomplete' });
  expect(resolve(() => null, () => checkpoint(), () => false)).toEqual({ termination: true, source: 'run-store', runStoreIo: 'dead-pid' });
  // ⛔⭐ `ps lstart` 는 «초» 해상도라 이 비교는 «세 값»이다 — 「같은 초」를 「재사용」이라 단정하지 않는다.
  //   해상도 «안»(같은 초)  ⇒ 구별 불가. 「재사용」도 「살아 있다」도 아니다
  //   ⓐ 기록과 «같거나 뒤» ⇒ 실제 기동이 그보다 이를 수 없다 = 남의 pid
  for (const s of [1_000, 1_001, 9_999]) {
    expect(resolve(() => null, () => checkpoint(), () => true, () => s)).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'pid-reused' });
  }
  //   ⓑ ⛔ 절단은 «내림»이라 실제 기동은 [startedAt, startedAt+1000) 안이다 — 그 구간이 기록을 «가로지르면» 못 가른다.
  //     🔑 반대 방향의 함정: createdAt=1500 · 실제 재사용 기동 1700 · 그런데 lstart 는 1000 으로 잘린다.
  //        구간 검사를 안 하면 「1000 < 1500 이니 앞」이라며 «running» 으로 오판한다.
  expect(resolve(() => null, () => checkpoint({ createdAt: 1_500 }), () => true, () => 1_000)).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'process-start-indistinguishable' });
  expect(resolve(() => null, () => checkpoint({ createdAt: 1_999 }), () => true, () => 1_000)).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'process-start-indistinguishable' });
  //   ⓒ 구간이 «통째로» 기록보다 앞 ⇒ 같은 프로세스
  expect(resolve(() => null, () => checkpoint({ createdAt: 2_000 }), () => true, () => 1_000)).toEqual({ termination: false, source: 'run-store', runStoreIo: 'live' });
  expect(resolve(() => null, () => checkpoint(), () => true, () => null)).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'process-start-unverifiable' });
  for (const malformed of ['null', '"checkpoint"', '[]', checkpoint({ runId: 'other-run' })]) {
    expect(resolve(() => null, () => malformed)).toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'incomplete' });
  }
});

test('pty list JSON emits default resolver usage when a supplied dependency omits runTerminated', () => {
  const row: PtyManifestRow = {
    id: 'pty_default_resolver', kind: 'pty', cmd: 'bun', ownerPid: 1, ptyPid: 1, instance: 'test', startedAt: 0, alive: true,
    exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0, outputBytesTotal: 0,
    runId: 'run-present', runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentKind: '', parentPid: 0, closedAt: 0, codeSha: '',
  };
  const deps: PtyTakeoverCommandDeps = {
    currentManifestDbPath: () => '/test/pty/manifest.db',
    manifestTargets: () => [{ name: 'test', dbPath: '/test/pty/manifest.db' }],
    listManifestRowsAt: () => [row],
    isProcessAlive: () => true,
    getPty: () => { throw new Error('unexpected getPty'); },
    requestPtyTakeover: () => { throw new Error('unexpected requestPtyTakeover'); },
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: () => {},
  };

  const result = JSON.parse(runPtyList(deps, { json: true }).message)[0];
  expect(result.runTerminated).not.toBe('no-run-id');
  expect(result.ownerRunUsage).toBe('unknown');
});

test('owner run usage distinguishes terminated, running, missing, unknown, and unprovable owners', () => {
  expect(classifyPtyOwnerRunUsage(true, true)).toBe('terminated-live-owner');
  expect(classifyPtyOwnerRunUsage(true, false)).toBe('running');
  expect(classifyPtyOwnerRunUsage(true, 'no-run-id')).toBe('no-run-id');
  for (const termination of ['ledger-not-found', 'ledger-indeterminate', 'ledger-read-failed'] as const) {
    expect(classifyPtyOwnerRunUsage(true, termination)).toBe('unknown');
  }
  expect(classifyPtyOwnerRunUsage(false, true)).toBe('unknown');
  expect(classifyPtyOwnerRunUsage(undefined, true)).toBe('unknown');
});

test('pty list JSON and text emit owner run usage and log only terminated live owners', () => {
  const rows: PtyManifestRow[] = [
    'terminated', 'running', 'missing-run-id', 'ledger-absent', 'ledger-unreadable', 'dead-owner',
  ].map((id) => ({
    id: `pty_${id}`, kind: 'pty', cmd: 'bun', ownerPid: id === 'dead-owner' ? 2 : 1, ptyPid: 0, instance: 'test', startedAt: 0,
    alive: true, exitCode: null, snapshot: '', snapshotAt: 0, updatedAt: 0, frame: '', frameAt: 0, outputBytesTotal: 0,
    runId: id === 'missing-run-id' ? '' : `run_${id}`, runIdSource: '', spaceId: '', sessionId: '', parentPtyId: '', parentKind: '', parentPid: 0, closedAt: 0, codeSha: '',
  }));
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const deps: PtyTakeoverCommandDeps = {
    listManifestRows: () => rows,
    currentManifestDbPath: () => '/test/pty/manifest.db',
    manifestTargets: () => [{ name: 'test', dbPath: '/test/pty/manifest.db' }],
    listManifestRowsAt: () => rows,
    listRefs: () => rows.filter((row) => row.ownerPid === 1).map((row) => ({
      id: row.id, kind: row.kind, source: 'remote' as const, alive: true, runId: row.runId || undefined,
    })),
    isProcessAlive: (pid) => pid === 1,
    getPty: () => { throw new Error('unexpected getPty'); },
    requestPtyTakeover: () => { throw new Error('unexpected requestPtyTakeover'); },
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: (event, data) => events.push({ event, data }),
    runTerminated: (runId) => ({
      run_terminated: true,
      run_running: false,
      'run_ledger-absent': 'ledger-not-found',
      'run_ledger-unreadable': 'ledger-read-failed',
      'run_dead-owner': true,
    }[runId] ?? 'no-run-id') as ReturnType<NonNullable<PtyTakeoverCommandDeps['runTerminated']>>,
  };

  const json = JSON.parse(runPtyList(deps, { json: true }).message);
  expect(json.map((row: { ownerRunUsage: string }) => row.ownerRunUsage)).toEqual([
    'terminated-live-owner', 'running', 'no-run-id', 'unknown', 'unknown',
  ]);
  expect(events).toEqual([{ event: 'owner-run-terminated', data: { ptyId: 'pty_terminated', runId: 'run_terminated' } }, { event: 'list', data: { count: 5, federated: false, includeTest: false, json: true } }]);

  events.length = 0;
  const text = runPtyList(deps).message.split('\n');
  const expectedRows = [
    ['pty_terminated', 'run_terminated', 'terminated-live-owner'],
    ['pty_running', 'run_running', 'running'],
    ['pty_missing-run-id', '-', 'no-run-id'],
    ['pty_ledger-absent', 'run_ledger-absent', 'unknown'],
    ['pty_ledger-unreadable', 'run_ledger-unreadable', 'unknown'],
  ] as const;
  expect(text).toHaveLength(expectedRows.length + 1);
  for (const [index, [id, runId, ownerRunUsage]] of expectedRows.entries()) {
    const cells = text[index]!.split('\t');
    expect(cells.slice(0, 9)).toEqual([id, 'pty', '-', 'remote', 'alive', '?', '-', runId, ownerRunUsage]);
    expect(cells).toContain('origin=unknown reason=legacy-or-malformed-origin-decision');
    expect(cells).toContain('purpose=workdir-not-recorded');
  }
  expect(text.at(-1)).toBe('purpose-known rows: 0/5');
  expect(events.filter(({ event }) => event === 'owner-run-terminated')).toEqual([{ event: 'owner-run-terminated', data: { ptyId: 'pty_terminated', runId: 'run_terminated' } }]);
});

test('federated text list preserves unknown liveness and missing resolver separately from missing run IDs', () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const deps: PtyTakeoverCommandDeps = {
    listFederatedRefs: () => ({ refs: [
      { instance: 'test', id: 'pty_unknown-owner', kind: 'pty', alive: true, runId: 'run-terminated' },
      { instance: 'test', id: 'pty_no-resolver', kind: 'pty', alive: true, ownerProcessAlive: true, runId: 'run-present' },
      { instance: 'test', id: 'pty_missing-run', kind: 'pty', alive: true, ownerProcessAlive: true },
    ], unreadable: [] }),
    getPty: () => { throw new Error('unexpected getPty'); },
    requestPtyTakeover: () => { throw new Error('unexpected requestPtyTakeover'); },
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: (event, data) => events.push({ event, data }),
  };

  const text = runPtyList(deps, { all: true }).message.split('\n');
  const expectedRows = [
    ['pty_unknown-owner', 'run-terminated', 'unknown'],
    ['pty_no-resolver', 'run-present', 'unknown'],
    ['pty_missing-run', '-', 'no-run-id'],
  ] as const;
  expect(text).toHaveLength(expectedRows.length + 1);
  for (const [index, [id, runId, ownerRunUsage]] of expectedRows.entries()) {
    const cells = text[index]!.split('\t');
    expect(cells.slice(0, 8)).toEqual(['test', '-', id, 'pty', '-', 'alive', runId, ownerRunUsage]);
    expect(cells).toContain('origin=unknown reason=legacy-or-malformed-origin-decision');
    expect(cells).toContain('purpose=workdir-not-recorded');
  }
  expect(text.at(-1)).toBe('purpose-known rows: 0/3');
  expect(events.filter(({ event }) => event === 'owner-run-terminated')).toEqual([]);
});

test('run termination continues after unreadable ledgers and returns a later valid answer', () => {
  const loads: string[] = [];
  const termination = resolveRunTermination('run-later', ['/broken', '/valid'], (_runId, directory) => {
    loads.push(directory);
    if (directory === '/broken') throw new Error('unreadable');
    return [{ runId: 'run-later', event: 'run-status', data: { runStatus: 'completed' } }];
  });



  expect(termination).toBe(true);
  expect(loads).toEqual(['/broken', '/valid']);
});

test('run termination exhausts indeterminate ledgers for a later definitive answer', () => {
  const loads: string[] = [];
  expect(resolveRunTermination('run-incomplete-then-complete', ['/incomplete', '/complete'], (_runId, directory) => {
    loads.push(directory);
    return directory === '/incomplete'
      ? []
      : [{ runId: 'run-incomplete-then-complete', event: 'run-status', data: { runStatus: 'completed' } }];
  })).toBe(true);
  expect(loads).toEqual(['/incomplete', '/complete']);
});

test('run termination distinguishes every indeterminate reason and records the exhausted lookup span', () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const log = (event: string, data: Record<string, unknown>) => events.push({ event, data });
  const directories = ['/first/run-ledger', '/second/run-ledger'];

  expect(resolveRunTermination('', directories, () => null, log)).toBe('no-run-id');
  expect(resolveRunTermination('run-missing', directories, () => null, log)).toBe('ledger-not-found');
  expect(resolveRunTermination('run-incomplete', directories, () => [], log)).toBe('ledger-indeterminate');
  expect(resolveRunTermination('run-broken', directories, (_runId, directory) => {
    if (directory === '/first/run-ledger') throw new Error('unreadable');
    return null;
  }, log)).toBe('ledger-read-failed');
  expect(resolveRunTermination('run-incomplete-then-broken', directories, (_runId, directory) => {
    if (directory === '/first/run-ledger') return [];
    throw new Error('unreadable');
  }, log)).toBe('ledger-read-failed');
  expect(resolveRunTermination('run-two-broken', ['/first', '/second', '/third'], (_runId, directory) => {
    if (directory !== '/second') throw new Error('unreadable');
    return null;
  }, log)).toBe('ledger-read-failed');
  expect(events).toEqual([
    { event: 'run-termination-indeterminate', data: { runId: '', reason: 'no-run-id', ledgerDirectoriesChecked: 0, unreadableLedgerDirectories: 0 } },
    { event: 'run-termination-indeterminate', data: { runId: 'run-missing', reason: 'ledger-not-found', ledgerDirectoriesChecked: 2, unreadableLedgerDirectories: 0 } },
    { event: 'run-termination-indeterminate', data: { runId: 'run-incomplete', reason: 'ledger-indeterminate', ledgerDirectoriesChecked: 2, unreadableLedgerDirectories: 0 } },
    { event: 'run-termination-indeterminate', data: { runId: 'run-broken', reason: 'ledger-read-failed', ledgerDirectoriesChecked: 2, unreadableLedgerDirectories: 1 } },
    { event: 'run-termination-indeterminate', data: { runId: 'run-incomplete-then-broken', reason: 'ledger-read-failed', ledgerDirectoriesChecked: 2, unreadableLedgerDirectories: 1 } },
    { event: 'run-termination-indeterminate', data: { runId: 'run-two-broken', reason: 'ledger-read-failed', ledgerDirectoriesChecked: 3, unreadableLedgerDirectories: 2 } },
  ]);
});

// ⭐⭐ 2026-08-19 — `N5c` 실측이 요구한 «쌍»의 나머지 반.
//   「살아 있는데 아무도 안 쓰는 화면」은 ***구조적 신호(썼나·만졌나) ⊕ 나이***로만 답할 수 있고,
//   나이 축이 `pty list --json` 에 «없었다»(매니페스트엔 startedAt 이 이미 있었다).
//   ⛔ `updatedAgeMs` 로는 못 답한다 — 살아 있는 화면은 계속 갱신되어 그 값이 거의 항상 몇 초다.
function ageDeps(overrides: Partial<PtyManifestRow>, now: number): PtyTakeoverCommandDeps {
  const row: PtyManifestRow = {
    id: 'pty_age', kind: 'tui', cmd: 'bun', ownerPid: 1, ptyPid: 0, instance: 'test',
    startedAt: 0, alive: true, exitCode: null, snapshot: '', snapshotAt: 0, outputBytesTotal: 0,
    updatedAt: now - 5, frame: '', frameAt: 0, runId: '', runIdSource: '', spaceId: '', sessionId: '',
    parentPtyId: '', parentPid: 0, parentKind: '', closedAt: 0, codeSha: '',
    ...overrides,
  };
  return {
    currentManifestDbPath: () => '/test/pty/manifest.db',
    manifestTargets: () => [{ name: 'test', dbPath: '/test/pty/manifest.db' }],
    listManifestRowsAt: () => [row],
    isProcessAlive: () => true,
    now: () => now,
    getPty: () => undefined,
    requestPtyTakeover: () => false,
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: () => {},
    runTerminated: () => 'no-run-id',
  };
}

// 🪞 사후 리뷰가 「사람용 목록이 --include-test 를 안 넘긴다」를 must-fix 로 냈다.
//   ⛔ ***실측하면 그 경로에 «도달할 수 없다»*** — `--include-test` 는 `--all` 없이 주면
//   명시적으로 거부되기 때문이다(`pty list: --include-test only applies with --all`).
//   ⇒ 로컬 분기는 언제나 includeTest=false 이므로 하드코딩이 «옳았다».
//   ⭐ 그런데 그 전제를 «테스트가 붙들고 있지 않았다» — 거부가 사라지면 조용히 버그가 된다.
//   ⇒ 반론만 하지 않고 ***그 전제를 회귀로 못 박는다***.
test('⛔ --include-test 는 --all 없이는 «거부»된다 — 그래서 로컬 분기는 test 원장을 볼 일이 없다', () => {
  const deps: PtyTakeoverCommandDeps = {
    listRefs: () => [{ id: 'pty_it', kind: 'tui', alive: true } as unknown as never],
    getPty: () => undefined,
    requestPtyTakeover: () => false,
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: () => {},
    runTerminated: () => { throw new Error('거부된 조합에서는 원장을 물어선 안 된다'); },
  };
  const result = runPtyList(deps, { includeTest: true });
  expect(result.exitCode).toBe(1);
  expect(result.message).toContain('--include-test only applies with --all');
});

test('--all --include-test 는 원장 조회에 «그대로» 넘어간다', () => {
  const seen: boolean[] = [];
  const deps: PtyTakeoverCommandDeps = {
    listFederatedRefs: () => ({ refs: [{ instance: 'test:x', id: 'pty_it', kind: 'tui', alive: true, ownerProcessAlive: true, runId: 'run-it' }], unreadable: [] }),
    getPty: () => undefined,
    requestPtyTakeover: () => false,
    requestRemote: async () => ({ status: 'unknown-pty' }),
    log: () => {},
    runTerminated: (_runId: string, opts?: { includeTest: boolean }): RunTermination => {
      seen.push(opts?.includeTest === true);
      return 'ledger-not-found';
    },
  };
  runPtyList(deps, { all: true, includeTest: true });
  expect(seen).toEqual([true]);
});

test('ageMs 는 「얼마나 오래 있었나」이고 updatedAgeMs 와 «다른 축»이다', () => {
  const now = 10_000_000;
  const result = JSON.parse(runPtyList(ageDeps({ startedAt: now - 3_600_000 }, now), { json: true }).message)[0];
  expect(result.ageMs).toBe(3_600_000);   // 한 시간 전에 생겼다
  expect(result.updatedAgeMs).toBe(5);    // 그런데 «지금» 갱신 중이다
  // ⇒ 이 둘이 같은 값이면 「오래 있었지만 방금 하트비트한」 화면을 영영 못 집는다.
  expect(result.ageMs).not.toBe(result.updatedAgeMs);
});

test('⛔ startedAt 이 미상(0)이면 ageMs 를 «0으로 채우지 않고» 칸을 비운다', () => {
  const result = JSON.parse(runPtyList(ageDeps({ startedAt: 0 }, 10_000_000), { json: true }).message)[0];
  // 「0분 됐다」와 「못 잼」은 다른 값이다 — 0을 실으면 갓 뜬 화면과 구별이 사라진다.
  expect(result.ageMs).toBeUndefined();
  expect('ageMs' in result).toBe(false);
});

test('⛔ 시계 역전(startedAt > now)에서 ageMs 를 «0으로 깎지 않고» 칸을 비운다', () => {
  // ⭐ 리뷰 must-fix: 깎으면 「못 잼」이 「0분 됐다」로 둔갑한다.
  //   「나이가 0에 가깝다」는 «갓 뜬 화면»을 뜻하므로 그 둘을 섞으면 판정이 뒤집힌다.
  const now = 10_000_000;
  const result = JSON.parse(runPtyList(ageDeps({ startedAt: now + 60_000 }, now), { json: true }).message)[0];
  expect(result.ageMs).toBeUndefined();
  expect('ageMs' in result).toBe(false);
});

// ⛔⭐ 리뷰 should-fix — 폴백 시험들의 `read(path)` 가 «어떤 경로든» 받아 checkpoint 를 돌려줬다.
//   그러면 원장 디렉토리 → 런 스토어 경로 «매핑»이 틀려도 그 시험들이 «전부 초록»이다.
//   ⇒ 실제로 «어떤 경로»를 읽으려 했는지를 값으로 문다(배선을 무는 시험).
test('원장 디렉토리에서 런 스토어 «경로»를 옳게 만든다', () => {
  const dirs = ['/roots/a/run-ledger', '/roots/b/run-ledger'];
  const asked: string[] = [];
  ptyListRunTermination('run-store', dirs, () => null, (path) => {
    asked.push(path);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  }, () => true, () => 0);
  // ⛔ 생산 매퍼로 기대값을 지으면 «그 매퍼가 틀려도» 통과한다 — 대표 입력 하나는 «리터럴»로 못 박는다(리뷰 should-fix).
  expect(asked).toEqual(['/roots/a/self-dev-runs/run-store.json', '/roots/b/self-dev-runs/run-store.json']);
  // 그리고 나머지는 공용 매퍼와도 일치해야 한다(둘이 갈리면 어느 한쪽이 늙은 것이다).
  expect(asked).toEqual(dirs.map((d) => join(selfDevRunsDir(dirname(d)), 'run-store.json')));
});

// ⛔ 「LC_ALL=C 로 고정했다」를 시험이 «못 물면» 인라인으로 되돌아가도 초록이다(리뷰 should-fix).
test('ps 호출 환경은 로케일만 C 로 못 박고 나머지는 그대로 둔다', () => {
  const before = { PATH: '/usr/bin', LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8', HOME: '/home/x' };
  expect(ptyProcessStartEnv(before)).toEqual({ PATH: '/usr/bin', LC_ALL: 'C', LANG: 'C', HOME: '/home/x' });
  expect(before.LC_ALL).toBe('ko_KR.UTF-8');   // ⛔ 원본을 «변형하지 않는다»
});

// ⛔⭐⭐ 리뷰 should-fix — 위 시험들은 `read` 를 «주입»해 판정만 잰다. 그러면 실제 파일을 못 찾아도 초록이다.
//   ⇒ 진짜 디렉토리에 진짜 checkpoint 파일을 놓고 «실제 readFileSync» 로 끝까지 간다(배선 회귀).
test('배선 확인 — 실제 파일에서 원장 침묵 → 런 스토어 답까지 간다', () => {
  const root = mkdtempSync(join(tmpdir(), 'pty-runstore-'));
  try {
    const ledgerDir = join(root, 'state', 'run-ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const storeDir = selfDevRunsDir(dirname(ledgerDir));
    mkdirSync(storeDir, { recursive: true });
    // ⭐ 이 프로세스 자신을 쓴다 — 살아 있고, «생산 경로»로 그 기동 시각을 실제로 읽는다.
    //   ⛔ createdAt 을 벽시계로 짓지 않는다 — 그러면 시험이 «시계 가정»을 재게 된다.
    //     실제로 읽은 기동 시각에서 파생시켜 구간이 안 겹치는 것을 «결정론»으로 만든다.
    const measuredStart = liveProcessStartedAt(process.pid);
    expect(measuredStart).not.toBeNull();          // 못 읽으면 이 시험은 «측정 불가»다 — 조용히 통과시키지 않는다
    const createdAt = measuredStart! + 5_000;
    writeFileSync(join(storeDir, 'run-live.json'), JSON.stringify({ runId: 'run-live', createdAt, updatedAt: createdAt, results: [], pid: process.pid }));
    expect(ptyListRunTermination('run-live', [ledgerDir], () => null, (path) => readFileSync(path, 'utf8'), undefined, liveProcessStartedAt))
      .toEqual({ termination: false, source: 'run-store', runStoreIo: 'live' });
    // 파일이 «없는» 런은 지어내지 않는다
    expect(ptyListRunTermination('run-absent', [ledgerDir], () => null, (path) => readFileSync(path, 'utf8'), undefined, liveProcessStartedAt))
      .toEqual({ termination: 'ledger-not-found', source: 'none', runStoreIo: 'not-found' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
