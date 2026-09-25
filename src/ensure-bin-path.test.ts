import { describe, test, expect } from 'bun:test';
import { ensureBinPath, CANDIDATE_BIN_DIRS } from './ensure-bin-path.js';
import { homedir } from 'node:os';

describe('ensureBinPath — cron/launchd 최소 PATH 보강', () => {
  test('최소 PATH(/usr/bin:/bin)에 gh 위치(/opt/homebrew/bin) 등 표준 bin append', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    const changed = ensureBinPath(env);
    expect(changed).toBe(true);
    expect(env.PATH!.split(':')).toContain('/opt/homebrew/bin'); // gh 를 찾을 수 있게
    // 기존 항목·우선순위 무접촉(앞쪽 유지) — append only.
    expect(env.PATH!.startsWith('/usr/bin:/bin')).toBe(true);
  });

  test('이미 모든 후보가 있으면 no-op(중복 append 안 함)', () => {
    const path = CANDIDATE_BIN_DIRS.join(':');
    const env: NodeJS.ProcessEnv = { PATH: path };
    const changed = ensureBinPath(env);
    expect(changed).toBe(false);
    expect(env.PATH).toBe(path);
  });

  test('빈/미정의 PATH 도 안전하게 후보로 채움', () => {
    const env: NodeJS.ProcessEnv = {};
    ensureBinPath(env);
    expect(env.PATH!.split(':')).toContain('/opt/homebrew/bin');
  });

  test('커스텀 후보에서 없는 것만 append(있는 건 skip)', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    ensureBinPath(env, ['/opt/x/bin', '/usr/bin', '/opt/y/bin']);
    expect(env.PATH).toBe('/usr/bin:/opt/x/bin:/opt/y/bin');
  });
});

// 🩸⛔⭐ 2026-09-03 — 이 둘이 «없어서» 무인 경로에서 claude·grok 백엔드가 죽고 있었다.
//    ⇒ 반증: 목록에서 빠지면 이 시험이 «시끄럽게» 깨진다.
describe('사용자 설치 CLI 자리 (claude · codex · grok)', () => {
  test('~/.local/bin 이 후보에 «있다» — claude·codex 가 거기 산다', () => {
    expect(CANDIDATE_BIN_DIRS).toContain(`${homedir()}/.local/bin`);
  });

  test('~/.grok/bin 이 후보에 «있다» — Linux 에선 심링크가 없을 수 있다', () => {
    expect(CANDIDATE_BIN_DIRS).toContain(`${homedir()}/.grok/bin`);
  });

  test('⛔ 기존 항목·순서는 «무접촉» — append 전용이다', () => {
    // 🔑 앞자리를 바꾸면 「어느 codex 를 부르나」가 조용히 달라진다.
    expect(CANDIDATE_BIN_DIRS.slice(0, 3)).toEqual([
      '/opt/homebrew/bin', '/usr/local/bin', `${homedir()}/.bun/bin`,
    ]);
    expect(CANDIDATE_BIN_DIRS.slice(-2)).toEqual(['/usr/bin', '/bin']);
  });

  test('📏 최소 PATH 를 보강하면 «두 자리»가 실제로 들어온다', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
    ensureBinPath(env);
    const parts = env.PATH!.split(':');
    expect(parts).toContain(`${homedir()}/.local/bin`);
    expect(parts).toContain(`${homedir()}/.grok/bin`);
    expect(env.PATH!.startsWith('/usr/bin:/bin')).toBe(true);  // ⛔ 기존 우선순위 보존
  });
});
