// Historian 파일 냉동보관(H3) — ③④⑤·run-lock·state.json move 통합 테스트
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { coldArchiveMissionFiles } from './historian.js';
import { coldFilesDir } from './cold-ledger.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../../monad-config-dir.js';
import { groundingCachePath } from '../mission-grounding-cache.js';
import { framePath } from '../pipeline/frame-journal.js';
import { execFramePath } from '../pipeline/exec-frame-journal.js';
import { missionStatePath } from '../pipeline/mission-state-assemble.js';
import { runLockPath } from '../mission-run-lock.js';

const MID = 'apm_historian-files-test_xyz789';
let stateDir: string;
let configDir: string;
let prevState: string | undefined;

function touch(p: string): void { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 'x'); }

describe('coldArchiveMissionFiles — 고아 파일 냉동보관 move(H3)', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'lineage-state-'));
    configDir = mkdtempSync(join(tmpdir(), 'lineage-config-'));
    prevState = process.env.MONAD_STATE_DIR;
    process.env.MONAD_STATE_DIR = stateDir;
    setMonadConfigDir(configDir);
  });
  afterEach(() => {
    resetMonadConfigDir(); // ★ 전역 config-dir override 복원(누수 방지 — config-isolation 등 후속 테스트 오염 차단)
    if (prevState === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = prevState;
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(configDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('④⑤ 프레임·캐시·run-lock·state 를 cold files 로 move·live 청소', async () => {
    touch(groundingCachePath(MID)); // ⑤ + 부모 디렉토리(② 라이브 wm 동거)
    touch(framePath(MID)); // ③
    touch(execFramePath(MID)); // ④
    touch(missionStatePath(MID)); // state.json
    touch(runLockPath(MID)); // run-lock

    const { moved } = await coldArchiveMissionFiles(MID);
    expect(moved).toBeGreaterThanOrEqual(3); // missions 디렉토리 + frames(≥1) + run-lock

    // live 경로 청소 확인
    expect(existsSync(groundingCachePath(MID))).toBe(false);
    expect(existsSync(framePath(MID))).toBe(false);
    expect(existsSync(runLockPath(MID))).toBe(false);

    // cold 로 이동 확인
    const cold = coldFilesDir(MID);
    expect(existsSync(cold)).toBe(true);
    const framesCold = join(cold, 'frames');
    expect(existsSync(framesCold)).toBe(true);
    expect(readdirSync(framesCold).length).toBeGreaterThanOrEqual(2); // jsonl + exec.jsonl + state
  });

  it('파일 없어도 fail-soft(moved 0·예외 없음)', async () => {
    const { moved } = await coldArchiveMissionFiles('apm_nonexistent_000');
    expect(moved).toBe(0);
  });
});
