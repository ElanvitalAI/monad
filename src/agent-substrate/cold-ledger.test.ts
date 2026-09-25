// 공용 cold ledger(C2 승격) — 제네릭 냉동보관(kind 네임스페이스·generic <T>) 검증.
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coldLedgerPath, coldFilesDir, writeColdSnapshot, readColdSnapshot, hasColdSnapshot } from './cold-ledger.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../monad-config-dir.js';

interface DemoSnap { id: string; note: string; items: number[]; }

describe('cold-ledger — 제네릭 냉동보관(kind·<T>)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cold-ledger-c2-')); setMonadConfigDir(dir); });
  afterEach(() => { resetMonadConfigDir(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  it('kind 네임스페이스로 경로 분리', () => {
    expect(coldLedgerPath('m1', 'lineage-cold')).toContain(join('archive', 'lineage-cold', 'm1'));
    expect(coldLedgerPath('m1', 'harness-run')).toContain(join('archive', 'harness-run', 'm1'));
    expect(coldFilesDir('m1', 'harness-run')).toContain(join('archive', 'harness-run', 'm1', 'files'));
  });

  it('write → read 왕복(generic <T>)', () => {
    const snap: DemoSnap = { id: 'run7', note: '체크포인트', items: [1, 2, 3] };
    expect(hasColdSnapshot('run7', 'harness-run')).toBe(false);
    writeColdSnapshot('run7', 'harness-run', snap);
    expect(hasColdSnapshot('run7', 'harness-run')).toBe(true);
    expect(readColdSnapshot<DemoSnap>('run7', 'harness-run')).toEqual(snap);
  });

  it('없으면 null·kind 격리(다른 kind 는 미도달)', () => {
    writeColdSnapshot('run7', 'harness-run', { id: 'run7', note: 'x', items: [] });
    expect(readColdSnapshot<DemoSnap>('run7', 'lineage-cold')).toBeNull();  // 다른 kind
    expect(readColdSnapshot<DemoSnap>('nope', 'harness-run')).toBeNull();
  });

  it('안전 slug(비파괴 문자 치환)', () => {
    writeColdSnapshot('a/b:c', 'harness-run', { id: 'a/b:c', note: '', items: [] });
    expect(hasColdSnapshot('a/b:c', 'harness-run')).toBe(true);
    expect(existsSync(coldLedgerPath('a/b:c', 'harness-run'))).toBe(true);
  });
});
