// Lineage cold ledger — 냉동보관 round-trip (H2)
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coldLedgerPath, writeColdSnapshot, readColdSnapshot, hasColdSnapshot, type ColdLineageSnapshot } from './cold-ledger.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../../elanous-config-dir.js';

const MID = 'apm_cold-test_abc123';
let dir: string;

const snap = (over: Partial<ColdLineageSnapshot> = {}): ColdLineageSnapshot => ({
  missionId: MID,
  reason: 'cancel-purge',
  archivedAt: '2026-07-20T10:00:00Z',
  goal: '테스트 골',
  currentGeneration: 2,
  revisions: [{ generation: 0, archivedAt: 1, reason: 'rerun', fromPhaseIndex: 0, phases: [] }],
  workingMemoryCount: 5,
  ...over,
});

describe('cold ledger — 냉동보관 round-trip', () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lineage-cold-')); setElanousConfigDir(dir); });
  afterEach(() => { resetElanousConfigDir(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it('없으면 null·hasColdSnapshot false', () => {
    expect(readColdSnapshot(MID)).toBeNull();
    expect(hasColdSnapshot(MID)).toBe(false);
  });

  it('write→read round-trip(config-dir 상주)', () => {
    writeColdSnapshot(snap());
    expect(hasColdSnapshot(MID)).toBe(true);
    expect(existsSync(coldLedgerPath(MID))).toBe(true);
    const r = readColdSnapshot(MID);
    expect(r?.missionId).toBe(MID);
    expect(r?.reason).toBe('cancel-purge');
    expect(r?.currentGeneration).toBe(2);
    expect(r?.revisions.length).toBe(1);
    expect(r?.workingMemoryCount).toBe(5);
  });

  it('경로가 config-dir/archive/lineage-cold 하위(never prune 존)', () => {
    expect(coldLedgerPath(MID)).toContain('archive');
    expect(coldLedgerPath(MID)).toContain('lineage-cold');
  });
});
