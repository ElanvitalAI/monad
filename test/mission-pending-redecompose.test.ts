// 미션 pending redecompose 슬롯 단위테스트 (BC3) — comment 저장·taps 예산 보존/증가.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  savePendingRedecompose,
  readPendingRedecompose,
  readRedecomposeTaps,
  bumpRedecomposeTaps,
  clearPendingRedecompose,
} from '../src/autopilot/mission-pending-redecompose.js';

let stateDir = '';
const prevEnv = process.env.MONAD_STATE_DIR;
beforeAll(() => { stateDir = mkdtempSync(join(tmpdir(), 'mredec-')); process.env.MONAD_STATE_DIR = stateDir; });
afterAll(() => {
  if (prevEnv === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prevEnv;
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('pending-redecompose 슬롯', () => {
  test('없으면 null·taps 0', () => {
    expect(readPendingRedecompose('m-none')).toBeNull();
    expect(readRedecomposeTaps('m-none')).toBe(0);
  });

  test('저장 → comment/taps 조회', () => {
    savePendingRedecompose('m1', '재분해 지시', '2026-07-16T00:00:00Z');
    const p = readPendingRedecompose('m1');
    expect(p?.comment).toBe('재분해 지시');
    expect(p?.taps).toBe(0);
  });

  test('재저장은 taps 보존(카드 재렌더·예산 유지)', () => {
    savePendingRedecompose('m2', 'v1');
    bumpRedecomposeTaps('m2');            // taps 1
    savePendingRedecompose('m2', 'v2');   // comment 갱신·taps 보존
    const p = readPendingRedecompose('m2');
    expect(p?.comment).toBe('v2');
    expect(p?.taps).toBe(1);
  });

  test('bump 은 taps+1·갱신 슬롯 반환', () => {
    savePendingRedecompose('m3', 'c');
    expect(bumpRedecomposeTaps('m3')?.taps).toBe(1);
    expect(bumpRedecomposeTaps('m3')?.taps).toBe(2);
    expect(readRedecomposeTaps('m3')).toBe(2);
  });

  test('슬롯 없을 때 bump 은 null(방어)', () => {
    expect(bumpRedecomposeTaps('m-absent')).toBeNull();
  });

  test('clear 후 null', () => {
    savePendingRedecompose('m4', 'c');
    clearPendingRedecompose('m4');
    expect(readPendingRedecompose('m4')).toBeNull();
  });
});
