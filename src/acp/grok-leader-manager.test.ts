// src/acp/grok-leader-manager.test.ts
//
// GrokLeaderManager 의 lifecycle + spawn args contract 검증. 실제 grok
// binary 를 spawn 하지 않음 — resolveGrokBin 의 PATH fallback + state
// snapshot + spawnClient args shape 만 검증. 실 leader process 의 round-
// trip 은 별 integration test (사용자 환경에서 manual smoke).

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  GrokLeaderManager,
  getGrokLeaderManager,
  _resetGrokLeaderManager,
} from './grok-leader-manager.js';

describe('GrokLeaderManager · initial state', () => {
  beforeEach(() => {
    _resetGrokLeaderManager();
  });

  test('fresh instance has null state', () => {
    const mgr = new GrokLeaderManager();
    const state = mgr.state();
    expect(state.pid).toBeNull();
    expect(state.startedAt).toBeNull();
    expect(state.exitCode).toBeNull();
    expect(mgr._leaderProcess()).toBeNull();
  });

  test('shutdownLeader is no-op when nothing running', async () => {
    const mgr = new GrokLeaderManager();
    await mgr.shutdownLeader();
    expect(mgr.state().pid).toBeNull();
  });
});

describe('GrokLeaderManager · spawnClient args', () => {
  test('default args include `--leader` flag', () => {
    const mgr = new GrokLeaderManager();
    const { command, args } = mgr.spawnClient();
    expect(args).toEqual(['agent', 'stdio', '--leader']);
    expect(command).toMatch(/grok$/); // '~/grok' or 'grok'
  });

  test('extra args appended after `--leader`', () => {
    const mgr = new GrokLeaderManager();
    const { args } = mgr.spawnClient(['--model', 'grok-3']);
    expect(args).toEqual(['agent', 'stdio', '--leader', '--model', 'grok-3']);
  });
});

describe('GrokLeaderManager · singleton', () => {
  beforeEach(() => {
    _resetGrokLeaderManager();
  });

  test('getGrokLeaderManager returns same instance across calls', () => {
    const m1 = getGrokLeaderManager();
    const m2 = getGrokLeaderManager();
    expect(m1).toBe(m2);
  });

  test('_resetGrokLeaderManager creates fresh instance', () => {
    const m1 = getGrokLeaderManager();
    _resetGrokLeaderManager();
    const m2 = getGrokLeaderManager();
    expect(m1).not.toBe(m2);
  });
});

describe('GrokLeaderManager · ensureLeader idempotency contract', () => {
  // 본 테스트는 실 binary spawn — `grok` 명령이 PATH 또는 ~/.grok/bin/
  // 에 있을 때만 의미 있음. 없으면 spawn 이 ENOENT 로 즉시 fail · child
  // exitCode 가 set 됨. contract: ensureLeader 가 throw 안 함 (exit 은
  // 비동기), 두 번째 호출이 새 spawn 시도 (첫 instance 가 dead 인 경우).

  test('ensureLeader returns state object (does not throw)', () => {
    const mgr = new GrokLeaderManager();
    // 실 binary 미존재 시 ENOENT 가 'error' event 로 emit 됨 (sync 에서
    // throw 안 함). state 가 정상 반환되는지만 검증.
    const state = mgr.ensureLeader();
    expect(state).toBeDefined();
    expect(typeof state.pid === 'number' || state.pid === null).toBe(true);
    // Cleanup — leader 가 spawn 됐다면 즉시 kill (테스트 hang 방지)
    const proc = mgr._leaderProcess();
    if (proc && proc.exitCode === null) {
      proc.kill('SIGKILL');
    }
  });
});
