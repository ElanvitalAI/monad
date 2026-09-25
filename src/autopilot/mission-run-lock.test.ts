import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runLockPath, isRunLockActive, acquireRunLock, releaseRunLock,
} from './mission-run-lock.js';

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'runlock-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } dirs = []; });

describe('mission-run-lock', () => {
  it('acquire → active → release 주기', () => {
    const baseDir = tmp();
    expect(isRunLockActive('m1', { baseDir })).toBe(false);
    expect(acquireRunLock('m1', { baseDir, pid: 111, isAlive: () => true })).toBe(true);
    expect(existsSync(runLockPath('m1', { baseDir }))).toBe(true);
    expect(isRunLockActive('m1', { baseDir, isAlive: () => true })).toBe(true);
    releaseRunLock('m1', { baseDir });
    expect(isRunLockActive('m1', { baseDir })).toBe(false);
  });

  it('살아있는 락 보유 중 재획득 거부(single-flight)', () => {
    const baseDir = tmp();
    expect(acquireRunLock('m1', { baseDir, pid: 111, isAlive: () => true })).toBe(true);
    expect(acquireRunLock('m1', { baseDir, pid: 222, isAlive: () => true })).toBe(false); // 다른 프로세스 거부
  });

  it('stale 락(죽은 pid) 자동 청소 후 재획득 허용', () => {
    const baseDir = tmp();
    writeFileSync(runLockPath('m1', { baseDir }), '99999'); // 죽은 pid 를 수동으로 심음
    // isAlive=false → stale 로 판정·청소.
    expect(isRunLockActive('m1', { baseDir, isAlive: () => false })).toBe(false);
    expect(existsSync(runLockPath('m1', { baseDir }))).toBe(false); // 청소됨
    expect(acquireRunLock('m1', { baseDir, pid: 1, isAlive: () => false })).toBe(true);
  });

  it('서로 다른 미션은 독립 락', () => {
    const baseDir = tmp();
    expect(acquireRunLock('mA', { baseDir, isAlive: () => true })).toBe(true);
    expect(acquireRunLock('mB', { baseDir, isAlive: () => true })).toBe(true); // 독립
  });
});
