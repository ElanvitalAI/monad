// 워킹메모리 U2.5 — write-time compaction + 리비전별 풀 아카이브 (2026-07-19)
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWorkingMemory, readWorkingMemory,
  compactWorkingMemoryIfNeeded, missionWorkingMemoryPath,
  appendWorkingMemoryArchive, readWorkingMemoryArchive, missionWorkingMemoryArchivePath,
  type WorkingMemoryEntry,
} from '../src/autopilot/mission-working-memory.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

const MID = 'apm_test_u25';
const entry = (phaseId: string, summary = 's'): Omit<WorkingMemoryEntry, 'at'> => ({
  phaseId, phaseTitle: `p-${phaseId}`, kind: 'investigation', summary, reusables: [], decisions: [], artifacts: [],
});

describe('U2.5 — write-time compaction(라이브 성장 bound)', () => {
  let stateDir: string;
  beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'wm-state-')); process.env.MONAD_STATE_DIR = stateDir; });
  afterEach(() => { delete process.env.MONAD_STATE_DIR; try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('임계 미만이면 no-op(compacted=false)', () => {
    appendWorkingMemory(MID, entry('a'));
    const r = compactWorkingMemoryIfNeeded(MID, { thresholdBytes: 10_000 });
    expect(r.compacted).toBe(false);
    expect(r.entries).toBe(1);
  });

  test('임계 초과 시 dedup 재작성(파일 축소·유효 엔트리 보존)', () => {
    // 같은 phaseId 를 여러 번 append(rebuild 시뮬) → dedup 대상 다수·파일 성장.
    for (let i = 0; i < 200; i++) appendWorkingMemory(MID, entry('a', `s${i}-${'x'.repeat(200)}`));
    appendWorkingMemory(MID, entry('b', 'keep-b'));
    const before = statSync(missionWorkingMemoryPath(MID)).size;
    const r = compactWorkingMemoryIfNeeded(MID, { thresholdBytes: 1_000 }); // 낮은 임계로 강제 발동
    expect(r.compacted).toBe(true);
    const after = statSync(missionWorkingMemoryPath(MID)).size;
    expect(after).toBeLessThan(before);            // dedup 으로 축소
    const kept = readWorkingMemory(MID);
    expect(kept.map((e) => e.phaseId).sort()).toEqual(['a', 'b']); // 유효(latest-wins) 보존
    expect(kept.find((e) => e.phaseId === 'a')!.summary).toBe(`s199-${'x'.repeat(200)}`); // 최신 a
  });
});

describe('U2.5 — 리비전(generation)별 풀 아카이브', () => {
  let cfgDir: string, stateDir: string;
  beforeEach(() => {
    cfgDir = mkdtempSync(join(tmpdir(), 'wm-cfg-'));
    stateDir = mkdtempSync(join(tmpdir(), 'wm-state-'));
    setMonadConfigDir(cfgDir); process.env.MONAD_STATE_DIR = stateDir;
  });
  afterEach(() => {
    resetMonadConfigDir(); delete process.env.MONAD_STATE_DIR;
    for (const d of [cfgDir, stateDir]) try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('아카이브는 config dir 아래(state dir 와 분기)', () => {
    const p = missionWorkingMemoryArchivePath(MID, 0);
    expect(p.startsWith(cfgDir)).toBe(true);
    expect(p).toContain(join('archive', 'working-memory'));
    expect(p.endsWith('gen-0.jsonl')).toBe(true);
  });

  test('리비전별 파티션 — gen 별로 분리 보관·전 세대 병합 read', () => {
    appendWorkingMemoryArchive(MID, entry('g0a'), 0);
    appendWorkingMemoryArchive(MID, entry('g0b'), 0);
    appendWorkingMemoryArchive(MID, entry('g1a'), 1);
    // 세대별 조회
    expect(readWorkingMemoryArchive(MID, { generation: 0 }).map((e) => e.phaseId)).toEqual(['g0a', 'g0b']);
    expect(readWorkingMemoryArchive(MID, { generation: 1 }).map((e) => e.phaseId)).toEqual(['g1a']);
    // 전 세대 병합(과거→현재·리플레이 풀 스토리)
    expect(readWorkingMemoryArchive(MID).map((e) => e.phaseId)).toEqual(['g0a', 'g0b', 'g1a']);
  });

  test('아카이브는 never prune — 같은 phaseId 중복도 풀 보관(dedup 안 함)', () => {
    for (let i = 0; i < 5; i++) appendWorkingMemoryArchive(MID, entry('a', `rev-${i}`), 0);
    const all = readWorkingMemoryArchive(MID, { generation: 0 });
    expect(all.length).toBe(5);  // 라이브 read 와 달리 dedup 없음(풀 히스토리)
  });
});
