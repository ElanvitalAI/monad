// Phase 1 (PLAN-config-unification-monad-root-2026-05-10) ·
// `userConfigPath()` redirect behavior:
//   - XDG_CONFIG_HOME explicit → legacy XDG path (back-compat for Phase 6 deprecation window + test isolation)
//   - else → NEXUS canonical helper (~/.monad/config.json · honors setMonadConfigDir)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { userConfigPath } from '../src/user-config';
import { userConfigPath as nexusUserConfigPath } from '../src/nexus/config/paths';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';
import { effectiveInstanceRoot } from '../src/instance/resolve.js';

const prevXdg = process.env.XDG_CONFIG_HOME;

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cfg-redirect-'));
  delete process.env.XDG_CONFIG_HOME;
  resetMonadConfigDir();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  resetMonadConfigDir();
});

describe('userConfigPath · Phase 1 redirect', () => {
  test('no override → the effective instance root config (NEXUS canonical)', () => {
    // ⛔ «~/.monad» 가 아니다 — config-dir 은 state-dir 을 따라간다(§4d · `monad-config-dir.ts`). 운영에선 ~/.monad,
    //   시험 프리로드(`test/preload-isolation.ts`)가 MONAD_STATE_DIR 을 격리하면 그 뿌리다.
    expect(userConfigPath()).toBe(join(effectiveInstanceRoot(), 'config.json'));
    expect(userConfigPath()).toBe(nexusUserConfigPath());
  });

  test('setMonadConfigDir override → <override>/config.json', () => {
    setMonadConfigDir(tmpRoot);
    expect(userConfigPath()).toBe(join(tmpRoot, 'config.json'));
    expect(userConfigPath()).toBe(nexusUserConfigPath());
  });

  test('XDG_CONFIG_HOME explicit → legacy XDG path (back-compat)', () => {
    process.env.XDG_CONFIG_HOME = tmpRoot;
    expect(userConfigPath()).toBe(join(tmpRoot, 'monad', 'config.json'));
  });

  test('XDG_CONFIG_HOME wins over setMonadConfigDir for Path A reads', () => {
    process.env.XDG_CONFIG_HOME = tmpRoot;
    setMonadConfigDir(join(tmpRoot, 'daemon-dir'));
    expect(userConfigPath()).toBe(join(tmpRoot, 'monad', 'config.json'));
  });

  test('empty XDG_CONFIG_HOME falls through to NEXUS helper', () => {
    process.env.XDG_CONFIG_HOME = '   ';
    expect(userConfigPath()).toBe(nexusUserConfigPath());
  });
});
