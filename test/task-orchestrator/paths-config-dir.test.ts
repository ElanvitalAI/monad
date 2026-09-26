// FU8 PR #4 (2026-05-12) — env vars retire: tasksRoot / tasksDbPath /
// backupsRoot now route through getElanousConfigDir() instead of the
// legacy hard-coded `~/.elanous/{tasks,backups}` paths. Verifies:
//   - `--config-dir <dir>` (via setElanousConfigDir) redirects all
//     three accessors atomically.
//   - Pre-FU8 env vars (`ELANOUS_TASKS_DIR`, `ELANOUS_TASKS_DB`,
//     `ELANOUS_BACKUPS_DIR`) still win as a legacy fallback so any
//     caller that set them pre-FU8 keeps working without churn
//     (per feedback_user_config_over_env).
//   - Defaults (no override, no env) fall back to `~/.elanous/...`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { tasksRoot, tasksDbPath } from '../../src/task-orchestrator/paths';
import { backupsRoot } from '../../src/task-orchestrator/backup';
import {
  getElanousConfigDir,
  setElanousConfigDir,
  resetElanousConfigDir,
} from '../../src/elanous-config-dir';

const ENV_KEYS = ['ELANOUS_TASKS_DIR', 'ELANOUS_TASKS_DB', 'ELANOUS_BACKUPS_DIR'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetElanousConfigDir();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetElanousConfigDir();
});

describe('FU8 PR #4 · paths route through getElanousConfigDir()', () => {
  // ⛔ `homedir()/.elanous` 를 «하드코딩하지 않는다» — 그것이 기본인 것은 «운영 우주»에서뿐이다.
  //   격리 시험 우주에서는 기본이 `…/elanous-test-global-<pid>` 이고, 그렇게 되는 것이 «옳은 동작»이다
  //   (📏 2026-08-28 실측: 하드코딩 탓에 이 절과 아래 reset 절이 격리에서 항상 빨갰다).
  // ✅ 이 시험의 «목적»은 제목이 말한다 — 「paths 가 getElanousConfigDir() 를 지나는가」.
  //   그러니 재야 할 것은 「그 해석기가 지금 내는 값과 같은가」다.
  test('default (no env, no override) → getElanousConfigDir() 아래로 간다', () => {
    const base = getElanousConfigDir();
    expect(tasksRoot()).toBe(join(base, 'tasks'));
    expect(tasksDbPath()).toBe(join(base, 'tasks', 'tasks.db'));
    expect(backupsRoot()).toBe(join(base, 'backups'));
  });

  test('--config-dir <dir> (setElanousConfigDir) redirects all three accessors', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fu8-cfg-'));
    setElanousConfigDir(tmp);
    expect(tasksRoot()).toBe(join(tmp, 'tasks'));
    expect(tasksDbPath()).toBe(join(tmp, 'tasks', 'tasks.db'));
    expect(backupsRoot()).toBe(join(tmp, 'backups'));
  });

  test('ELANOUS_TASKS_DIR (legacy) still wins over config-dir for tasksRoot', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'fu8-cfg-'));
    const legacy = mkdtempSync(join(tmpdir(), 'fu8-legacy-tasks-'));
    setElanousConfigDir(cfg);
    process.env.ELANOUS_TASKS_DIR = legacy;
    expect(tasksRoot()).toBe(legacy);
    expect(tasksDbPath()).toBe(join(legacy, 'tasks.db'));
    // backupsRoot has its own env var and is not affected.
    expect(backupsRoot()).toBe(join(cfg, 'backups'));
  });

  test('ELANOUS_TASKS_DB (legacy) still wins over config-dir for tasksDbPath', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'fu8-cfg-'));
    const legacyDb = join(cfg, '..', 'custom.db');
    setElanousConfigDir(cfg);
    process.env.ELANOUS_TASKS_DB = legacyDb;
    expect(tasksDbPath()).toBe(legacyDb);
    // tasksRoot is unaffected when only ELANOUS_TASKS_DB is set.
    expect(tasksRoot()).toBe(join(cfg, 'tasks'));
  });

  test('ELANOUS_BACKUPS_DIR (legacy) still wins over config-dir for backupsRoot', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'fu8-cfg-'));
    const legacyBackups = mkdtempSync(join(tmpdir(), 'fu8-legacy-backups-'));
    setElanousConfigDir(cfg);
    process.env.ELANOUS_BACKUPS_DIR = legacyBackups;
    expect(backupsRoot()).toBe(legacyBackups);
    // Other accessors honour the config-dir.
    expect(tasksRoot()).toBe(join(cfg, 'tasks'));
  });

  test('resetElanousConfigDir restores the default path resolution', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fu8-cfg-'));
    setElanousConfigDir(tmp);
    expect(tasksRoot()).toBe(join(tmp, 'tasks'));
    resetElanousConfigDir();
    // 되돌린 뒤의 기본도 «그 우주의» 기본이다 — 운영이면 ~/.elanous, 격리면 test-global.
    expect(tasksRoot()).toBe(join(getElanousConfigDir(), 'tasks'));
    // ⊕ 되돌림이 실제로 «일어났는지»를 따로 문다(위 한 줄만으로는 tmp 가 그대로여도 통과할 수 있다).
    expect(tasksRoot()).not.toBe(join(tmp, 'tasks'));
  });
});
