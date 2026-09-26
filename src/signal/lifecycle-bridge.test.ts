import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stateDir = mkdtempSync(join(tmpdir(), 'lifecycle-bridge-test-'));
process.env.ELANOUS_STATE_DIR = stateDir;

const { ChannelBus } = await import('../terminal-matrix/channel-bus.js');
const { ptyManifestDbPath } = await import('../pty-shell/pty-manifest.js');
const { publishLifecycleRecord } = await import('./lifecycle-record.js');
const { attachLifecycleBridge, readRunLifecycle, readRunLifecycleFromStateDir, reapLifecycleRecords, resetLifecycleBridgeForTesting } = await import('./lifecycle-bridge.js');
import type { LifecycleRecord } from './lifecycle-record.js';

const base = { runId: 'run-a', ptyId: 'pty-a', subjectPtyId: 'pty-a', depth: 1, role: 'child' as const, seq: 1, at: 1_700_000_000_000, truncated: false as const };
const started = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({ ...base, class: 'progress', name: 'started', ...overrides } as LifecycleRecord);

function clearStore(): void {
  resetLifecycleBridgeForTesting();
  if (!existsSync(ptyManifestDbPath())) return;
  const d = new Database(ptyManifestDbPath());
  try { d.run('DELETE FROM lifecycle_records'); } catch { /* table is created by the first bridge attachment */ } finally { d.close(); }
}

afterEach(clearStore);
afterAll(() => {
  resetLifecycleBridgeForTesting();
  rmSync(stateDir, { recursive: true, force: true });
});

describe('lifecycle SQLite bridge', () => {
  test('persists backlog in order, supports cursors, preserves strict record shape, and detaches', () => {
    const bus = new ChannelBus();
    const detach = attachLifecycleBridge(bus, 'run-a');
    const first = started();
    const second = started({ seq: 2, name: 'progress', payload: { step: 'write' } } as Partial<LifecycleRecord>);
    publishLifecycleRecord(bus, first);
    publishLifecycleRecord(bus, second);

    const backlog = readRunLifecycle('run-a');
    expect(backlog.map(({ record }) => record)).toEqual([first, second]);
    expect(backlog[0]?.id).toBeLessThan(backlog[1]?.id ?? 0);
    expect(readRunLifecycle('run-a', backlog[0]?.id)).toEqual([backlog[1]]);

    detach();
    publishLifecycleRecord(bus, started({ seq: 3 }));
    expect(readRunLifecycle('run-a')).toHaveLength(2);
  });

  test('isolates sibling runs and silently deduplicates producer-local sequences', () => {
    const bus = new ChannelBus();
    attachLifecycleBridge(bus, 'run-a');
    attachLifecycleBridge(bus, 'run-b');
    const mine = started();
    const sibling = started({ runId: 'run-b', ptyId: 'pty-b', subjectPtyId: 'pty-b' });
    publishLifecycleRecord(bus, mine);
    publishLifecycleRecord(bus, sibling);
    publishLifecycleRecord(bus, mine);

    expect(readRunLifecycle('run-a').map(({ record }) => record)).toEqual([mine]);
    expect(readRunLifecycle('run-b').map(({ record }) => record)).toEqual([sibling]);
  });

  test('migrates a legacy schema and skips its rows with no subject rather than inferring one', () => {
    resetLifecycleBridgeForTesting();
    rmSync(ptyManifestDbPath(), { force: true });
    const legacy = new Database(ptyManifestDbPath());
    try {
      legacy.run(`CREATE TABLE lifecycle_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, pty_id TEXT NOT NULL,
        seq INTEGER NOT NULL, depth INTEGER NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL,
        class TEXT NOT NULL, name TEXT NOT NULL, transition TEXT, resumable INTEGER,
        payload_json TEXT, truncated INTEGER NOT NULL, truncated_fields_json TEXT, created_at INTEGER NOT NULL
      )`);
      legacy.run(`INSERT INTO lifecycle_records (run_id, pty_id, seq, depth, role, at, class, name, truncated, created_at)
        VALUES ('run-a', 'legacy-pty', 1, 1, 'child', 1, 'progress', 'started', 0, 0)`);
    } finally { legacy.close(); }

    const bus = new ChannelBus();
    attachLifecycleBridge(bus, 'run-a');
    const valid = started();
    publishLifecycleRecord(bus, valid);

    const migrated = new Database(ptyManifestDbPath());
    try {
      expect((migrated.query('PRAGMA table_info(lifecycle_records)').all() as { name: string }[]).some((column) => column.name === 'subject_pty_id')).toBe(true);
    } finally { migrated.close(); }
    expect(readRunLifecycle('run-a').map(({ record }) => record)).toEqual([valid]);
  });

  test('scans past corrupted rows before applying the result limit', () => {
    const bus = new ChannelBus();
    attachLifecycleBridge(bus, 'run-a');
    const d = new Database(ptyManifestDbPath());
    try {
      d.run(`INSERT INTO lifecycle_records (run_id, pty_id, seq, depth, role, at, class, name, truncated, created_at)
        VALUES ('run-a', 'corrupt', 1, 1, 'invalid-role', 1, 'progress', 'started', 0, 0)`);
    } finally { d.close(); }
    const valid = started();
    publishLifecycleRecord(bus, valid);

    expect(readRunLifecycle('run-a', 0, 1).map(({ record }) => record)).toEqual([valid]);
  });

  test('reaps only records older than the requested TTL', () => {
    const bus = new ChannelBus();
    attachLifecycleBridge(bus, 'run-a');
    const valid = started();
    publishLifecycleRecord(bus, valid);
    const d = new Database(ptyManifestDbPath());
    try {
      d.run("UPDATE lifecycle_records SET created_at=0 WHERE run_id='run-a'");
      d.run(`INSERT INTO lifecycle_records (run_id, pty_id, subject_pty_id, seq, depth, role, at, class, name, truncated, created_at)
        VALUES ('run-a', 'fresh', 'fresh', 1, 1, 'child', 1_700_000_000_000, 'progress', 'started', 0, ?)`, [Date.now()]);
    } finally { d.close(); }

    expect(reapLifecycleRecords(60_000)).toBe(1);
    expect(readRunLifecycle('run-a').map(({ record }) => record)).toEqual([started({ ptyId: 'fresh', subjectPtyId: 'fresh' })]);
  });

  test('reads an explicitly named child state directory and not a sibling directory', () => {
    const child = mkdtempSync(join(tmpdir(), 'lifecycle-child-'));
    const sibling = mkdtempSync(join(tmpdir(), 'lifecycle-sibling-'));
    const childPath = join(child, 'pty', 'manifest.db');
    mkdirSync(join(child, 'pty'), { recursive: true });
    const childDb = new Database(childPath);
    try {
      childDb.run(`CREATE TABLE lifecycle_records (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, pty_id TEXT NOT NULL, subject_pty_id TEXT NOT NULL,
        seq INTEGER NOT NULL, depth INTEGER NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL,
        class TEXT NOT NULL, name TEXT NOT NULL, transition TEXT, resumable INTEGER, payload_json TEXT,
        truncated INTEGER NOT NULL, truncated_fields_json TEXT
      )`);
      childDb.run(`INSERT INTO lifecycle_records VALUES (1, 'run-child', 'pty-child', 'pty-child', 1, 1, 'child', 1, 'progress', 'complete', NULL, NULL, '{"summary":"done","changedFiles":[]}', 0, NULL)`);
    } finally { childDb.close(); }
    try {
      expect(readRunLifecycleFromStateDir(child, 'run-child')).toHaveLength(1);
      expect(readRunLifecycleFromStateDir(sibling, 'run-child')).toEqual([]);
    } finally {
      rmSync(child, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  test('explicit reader returns empty for absent databases and databases without lifecycle_records', () => {
    const absent = mkdtempSync(join(tmpdir(), 'lifecycle-absent-'));
    const noTable = mkdtempSync(join(tmpdir(), 'lifecycle-no-table-'));
    mkdirSync(join(noTable, 'pty'), { recursive: true });
    const unrelated = new Database(join(noTable, 'pty', 'manifest.db'));
    try { unrelated.run('CREATE TABLE pty_manifest (id TEXT)'); } finally { unrelated.close(); }
    try {
      expect(() => readRunLifecycleFromStateDir(absent, 'run-a')).not.toThrow();
      expect(readRunLifecycleFromStateDir(absent, 'run-a')).toEqual([]);
      expect(() => readRunLifecycleFromStateDir(noTable, 'run-a')).not.toThrow();
      expect(readRunLifecycleFromStateDir(noTable, 'run-a')).toEqual([]);
    } finally {
      rmSync(absent, { recursive: true, force: true });
      rmSync(noTable, { recursive: true, force: true });
    }
  });

  test('is fail-soft when its SQLite path cannot be opened', () => {
    resetLifecycleBridgeForTesting();
    const prior = process.env.ELANOUS_STATE_DIR;
    const blockedPath = join(stateDir, 'not-a-directory');
    writeFileSync(blockedPath, 'file');
    process.env.ELANOUS_STATE_DIR = blockedPath;
    const bus = new ChannelBus();
    try {
      expect(() => attachLifecycleBridge(bus, 'run-a')).not.toThrow();
      expect(() => publishLifecycleRecord(bus, started())).not.toThrow();
      expect(readRunLifecycle('run-a')).toEqual([]);
    } finally {
      process.env.ELANOUS_STATE_DIR = prior;
      resetLifecycleBridgeForTesting();
    }
  });
});
