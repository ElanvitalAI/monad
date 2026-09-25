import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexCredentialRoot, quotaSignalDir } from './codex-reset-credit-state.js';

const prior = { dir: process.env.MONAD_STATE_DIR, src: process.env.MONAD_STATE_DIR_SOURCE, xdg: process.env.XDG_CONFIG_HOME };
afterEach(() => {
  for (const [k, v] of [['MONAD_STATE_DIR', prior.dir], ['MONAD_STATE_DIR_SOURCE', prior.src], ['XDG_CONFIG_HOME', prior.xdg]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

/**
 * ⛔⭐⭐ **env 에 값이 «있다»는 「사람이 격리를 말했다」가 아니다.**
 * 하니스가 자식을 띄울 때 파생된 우주 뿌리를 `MONAD_STATE_DIR` 로 «채워 넣는다»(`buildPtyEnv`).
 * 그 값을 명시로 읽으면 자식이 ***갱신되지 않는 자기 우주***를 보고 전 계정 `unknown` 이 된다.
 */
describe('codexCredentialRoot — 「명시」인지 출처로 가른다', () => {
  test('사람이 «말한» 격리는 존중한다', () => {
    process.env.MONAD_STATE_DIR = '/tmp/explicit-root';
    delete process.env.MONAD_STATE_DIR_SOURCE;
    expect(codexCredentialRoot()).toBe('/tmp/explicit-root');
    expect(quotaSignalDir()).toBe(join('/tmp/explicit-root', 'budget'));
  });

  test('⭐ «파생»으로 채워진 값은 «무시»한다 — 이것이 429 의 근본이었다', () => {
    process.env.MONAD_STATE_DIR = '/tmp/derived-worktree/.monad-test';
    process.env.MONAD_STATE_DIR_SOURCE = 'derived';
    delete process.env.XDG_CONFIG_HOME;
    expect(codexCredentialRoot()).toBe(join(homedir(), '.monad'));
    // ⭐ 그리고 그것이 «자격과 같은 뿌리»다 — 파생 우주가 아니다
    expect(quotaSignalDir()).not.toContain('.monad-test');
  });

  test('⛔ 출처가 «다른 값»이면 종전대로 존중한다 — 옛 자식 호환', () => {
    process.env.MONAD_STATE_DIR = '/tmp/some-root';
    process.env.MONAD_STATE_DIR_SOURCE = 'env';
    expect(codexCredentialRoot()).toBe('/tmp/some-root');
    process.env.MONAD_STATE_DIR_SOURCE = '';
    expect(codexCredentialRoot()).toBe('/tmp/some-root');
  });
});
