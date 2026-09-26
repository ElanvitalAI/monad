// 결정적-순간 키프레임 캡처 — 결정론 게이트(순수) + 저장/추출 round-trip.
import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isKeyframeMoment, keyframePath, writeKeyframePng, listKeyframes, keyframeDir } from './keyframe-capture.js';

describe('isKeyframeMoment (결정론 게이트)', () => {
  test('상태 전이 = 결정적 순간', () => {
    expect(isKeyframeMoment('idle', 'working')).toBe(true);
    expect(isKeyframeMoment('working', 'blocked')).toBe(true);
    expect(isKeyframeMoment('working', 'done')).toBe(true);
  });
  test('첫 분류(null→known)도 캡처', () => {
    expect(isKeyframeMoment(null, 'working')).toBe(true);
    expect(isKeyframeMoment(null, 'idle')).toBe(true);
  });
  test('동일 상태 = 캡처 안 함(매 프레임 sharp 방지)', () => {
    expect(isKeyframeMoment('working', 'working')).toBe(false);
    expect(isKeyframeMoment('blocked', 'blocked')).toBe(false);
  });
  test('unknown 은 항상 스킵(노이즈) — into/from 모두', () => {
    expect(isKeyframeMoment('working', 'unknown')).toBe(false); // known→unknown 스킵
    expect(isKeyframeMoment(null, 'unknown')).toBe(false);
    expect(isKeyframeMoment('unknown', 'working')).toBe(true);  // unknown→known 은 신호(캡처)
  });
});

describe('keyframePath (키 포맷)', () => {
  test('kf-<run>-<pty>-<seq3>-<state>.png', () => {
    const p = keyframePath('run7x', 'pty9', 3, 'blocked');
    expect(p.endsWith('kf-run7x-pty9-003-blocked.png')).toBe(true);
    expect(p).toContain('keyframes');
  });
  test('경로-비안전 토큰 정규화(파일명 안전)', () => {
    const p = keyframePath('a/b c', 'p/1', 0, 'done');
    expect(p).toContain('kf-a_b_c-p_1-000-done.png');
  });
  test('하이픈은 구분자라 값에서 치환(must-fix: 격리 모호성 차단)', () => {
    expect(keyframePath('run-x', 'pty-1', 2, 'working')).toContain('kf-run_x-pty_1-002-working.png');
  });
});

describe('write → list round-trip (격리 state-dir)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elanous-kf-test-'));
  const env = { ELANOUS_STATE_DIR: dir } as NodeJS.ProcessEnv;
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

  test('쓰고(fail-soft true) seq 순으로 조회', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic (내용 무관·존재만)
    // seq 를 일부러 뒤섞어 저장 → list 는 seq 오름차순 정렬 검증
    expect(writeKeyframePng(keyframePath('runA', 'ptyA', 2, 'working', env), png, env)).toBe(true);
    expect(writeKeyframePng(keyframePath('runA', 'ptyA', 0, 'idle', env), png, env)).toBe(true);
    expect(writeKeyframePng(keyframePath('runA', 'ptyA', 1, 'blocked', env), png, env)).toBe(true);
    // 다른 run 은 섞이지 않음(프리픽스 필터)
    expect(writeKeyframePng(keyframePath('runB', 'ptyB', 0, 'done', env), png, env)).toBe(true);

    const kfs = listKeyframes('runA', env);
    expect(kfs.map((k) => k.seq)).toEqual([0, 1, 2]);
    expect(kfs.map((k) => k.state)).toEqual(['idle', 'blocked', 'working']);
    expect(kfs.every((k) => k.ptyId === 'ptyA')).toBe(true);
    expect(kfs[0].bytes).toBe(4);

    expect(listKeyframes('runB', env).map((k) => k.state)).toEqual(['done']);
    expect(listKeyframes('nope', env)).toEqual([]);
  });

  test('하이픈 run 격리 — run 과 run-x 가 서로 안 섞임(must-fix)', () => {
    const png = Buffer.from([1]);
    writeKeyframePng(keyframePath('run', 'p', 0, 'idle', env), png, env);
    writeKeyframePng(keyframePath('run-x', 'p', 0, 'done', env), png, env); // safeToken→run_x
    expect(listKeyframes('run', env).map((k) => k.state)).toEqual(['idle']);   // run-x 미포함
    expect(listKeyframes('run-x', env).map((k) => k.state)).toEqual(['done']);
  });

  test('seq>=1000 도 파싱·조회됨(should-fix: 3자리 초과 견고)', () => {
    const png = Buffer.from([1]);
    writeKeyframePng(keyframePath('bigrun', 'p', 1000, 'working', env), png, env);
    expect(listKeyframes('bigrun', env).map((k) => k.seq)).toEqual([1000]);
  });

  test('keyframeDir 은 state-dir 스코프', () => {
    expect(keyframeDir(env)).toBe(join(dir, 'harness-screens', 'keyframes'));
  });
});
