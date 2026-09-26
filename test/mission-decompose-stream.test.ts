// 분해 스트리밍 파일 관측 단위테스트 — start/append/read (격리 state dir).
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startDecomposeStream,
  appendDecomposeStream,
  readDecomposeStream,
  decomposeStreamPath,
} from '../src/autopilot/mission-decompose-stream.js';

let stateDir = '';
const prevEnv = process.env.ELANOUS_STATE_DIR;
beforeAll(() => { stateDir = mkdtempSync(join(tmpdir(), 'dstream-')); process.env.ELANOUS_STATE_DIR = stateDir; });
afterAll(() => {
  if (prevEnv === undefined) delete process.env.ELANOUS_STATE_DIR; else process.env.ELANOUS_STATE_DIR = prevEnv;
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('decompose stream', () => {
  it('없으면 exists:false', () => {
    expect(readDecomposeStream('m-none').exists).toBe(false);
  });

  it('start → append 실시간 누적 → read', () => {
    startDecomposeStream('m1', { model: 'gpt-5.6-sol', at: '2026-07-17T00:00:00Z' });
    appendDecomposeStream('m1', '{"rationale":');
    appendDecomposeStream('m1', '"2 아크로 구성"}');
    const r = readDecomposeStream('m1');
    expect(r.exists).toBe(true);
    expect(r.content).toContain('model=gpt-5.6-sol');
    expect(r.content).toContain('2 아크로 구성');
    expect(r.chars).toBeGreaterThan(0);
  });

  it('start 는 초기화(재분해마다 새로)', () => {
    startDecomposeStream('m2', { model: 'x' });
    appendDecomposeStream('m2', 'OLD');
    startDecomposeStream('m2', { model: 'y' }); // 재시작 → OLD 제거
    appendDecomposeStream('m2', 'NEW');
    const r = readDecomposeStream('m2');
    expect(r.content).toContain('NEW');
    expect(r.content).not.toContain('OLD');
  });

  it('tailChars — 마지막 N자만', () => {
    startDecomposeStream('m3', { model: 'x' });
    appendDecomposeStream('m3', 'A'.repeat(500));
    const r = readDecomposeStream('m3', { tailChars: 100 });
    expect(r.content).toContain('생략');
    expect(r.content.length).toBeLessThan(300);
  });

  it('빈 delta 는 무시', () => {
    startDecomposeStream('m4', { model: 'x' });
    const before = readDecomposeStream('m4').chars;
    appendDecomposeStream('m4', '');
    expect(readDecomposeStream('m4').chars).toBe(before);
  });

  it('경로는 미션별 safe-slug', () => {
    expect(decomposeStreamPath('apm_x/y')).toContain('apm_x_y.log');
  });
});
