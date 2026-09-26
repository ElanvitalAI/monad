// Phase 1 (PLAN-config-unification-elanous-root-2026-05-10):
//   migrateLegacyXdgSubdir() — once-per-process · idempotent migration of
//   ~/.config/elanous/<subdir>/ → ~/.elanous/<subdir>/.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateLegacyXdgSubdir, migrateLegacyXdgFile,
  migrateLegacyHomeFile, migrateLegacyHomeDir,
  __resetLegacyMigrateForTests,
} from '../src/storage/legacy-elanous-dir-migrate';

const prevTestHome = process.env.ELANOUS_TEST_HOME;
let home: string;

function legacyDir(subdir: string): string {
  return join(home, '.config', 'elanous', subdir);
}
function newDir(subdir: string): string {
  return join(home, '.elanous', subdir);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'legacy-migrate-'));
  process.env.ELANOUS_TEST_HOME = home;
  __resetLegacyMigrateForTests();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevTestHome === undefined) delete process.env.ELANOUS_TEST_HOME;
  else process.env.ELANOUS_TEST_HOME = prevTestHome;
  __resetLegacyMigrateForTests();
});

describe('migrateLegacyXdgSubdir', () => {
  test('no-op when legacy dir does not exist', () => {
    migrateLegacyXdgSubdir('policy');
    expect(existsSync(newDir('policy'))).toBe(false);
  });

  test('migrates single JSON file + renames legacy → .bak', () => {
    mkdirSync(legacyDir('policy'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'overrides.json'),
      JSON.stringify({ v: 1, persistentDefault: { brand: 'claude' } }));

    migrateLegacyXdgSubdir('policy');

    expect(existsSync(join(newDir('policy'), 'overrides.json'))).toBe(true);
    const json = JSON.parse(readFileSync(join(newDir('policy'), 'overrides.json'), 'utf8'));
    expect(json.persistentDefault.brand).toBe('claude');

    expect(existsSync(legacyDir('policy'))).toBe(false);
    expect(existsSync(legacyDir('policy') + '.bak')).toBe(true);
  });

  test('migrates SQLite WAL set together (sqlite + shm + wal)', () => {
    mkdirSync(legacyDir('budget'), { recursive: true });
    writeFileSync(join(legacyDir('budget'), 'history.sqlite'), 'sqlite-magic');
    writeFileSync(join(legacyDir('budget'), 'history.sqlite-shm'), 'shm-bytes');
    writeFileSync(join(legacyDir('budget'), 'history.sqlite-wal'), 'wal-bytes');

    migrateLegacyXdgSubdir('budget');

    expect(readFileSync(join(newDir('budget'), 'history.sqlite'), 'utf8')).toBe('sqlite-magic');
    expect(readFileSync(join(newDir('budget'), 'history.sqlite-shm'), 'utf8')).toBe('shm-bytes');
    expect(readFileSync(join(newDir('budget'), 'history.sqlite-wal'), 'utf8')).toBe('wal-bytes');
    expect(existsSync(legacyDir('budget') + '.bak')).toBe(true);
  });

  test('skips when new dir already has files (no clobber)', () => {
    mkdirSync(legacyDir('policy'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'overrides.json'), '"old"');
    mkdirSync(newDir('policy'), { recursive: true });
    writeFileSync(join(newDir('policy'), 'overrides.json'), '"new"');

    migrateLegacyXdgSubdir('policy');

    expect(readFileSync(join(newDir('policy'), 'overrides.json'), 'utf8')).toBe('"new"');
    // legacy stays untouched (not renamed to .bak) since we skipped.
    expect(existsSync(legacyDir('policy'))).toBe(true);
    expect(existsSync(legacyDir('policy') + '.bak')).toBe(false);
  });

  test('idempotent within a single process', () => {
    mkdirSync(legacyDir('policy'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'overrides.json'), '"once"');

    migrateLegacyXdgSubdir('policy');
    expect(readdirSync(newDir('policy'))).toEqual(['overrides.json']);

    // Second call must be a no-op even if we re-create legacy with new content.
    mkdirSync(legacyDir('policy'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'overrides.json'), '"twice"');

    migrateLegacyXdgSubdir('policy');
    expect(readFileSync(join(newDir('policy'), 'overrides.json'), 'utf8')).toBe('"once"');
  });

  test('migrates policy and budget independently', () => {
    mkdirSync(legacyDir('policy'), { recursive: true });
    mkdirSync(legacyDir('budget'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'a.json'), '"p"');
    writeFileSync(join(legacyDir('budget'), 'b.json'), '"b"');

    migrateLegacyXdgSubdir('policy');
    migrateLegacyXdgSubdir('budget');

    expect(readFileSync(join(newDir('policy'), 'a.json'), 'utf8')).toBe('"p"');
    expect(readFileSync(join(newDir('budget'), 'b.json'), 'utf8')).toBe('"b"');
  });

  test('skips subdirectories silently (no recursion in Phase 1)', () => {
    mkdirSync(join(legacyDir('policy'), 'nested'), { recursive: true });
    writeFileSync(join(legacyDir('policy'), 'top.json'), '"top"');
    writeFileSync(join(legacyDir('policy'), 'nested', 'inner.json'), '"inner"');

    migrateLegacyXdgSubdir('policy');

    expect(existsSync(join(newDir('policy'), 'top.json'))).toBe(true);
    // Nested dir not migrated · neither store currently nests · documents intent.
    expect(existsSync(join(newDir('policy'), 'nested'))).toBe(false);
  });
});

describe('migrateLegacyXdgFile (FU2)', () => {
  function legacyFile(name: string): string {
    return join(home, '.config', 'elanous', name);
  }
  function newFile(name: string): string {
    return join(home, '.elanous', name);
  }

  test('no-op when legacy file does not exist', () => {
    migrateLegacyXdgFile('auth.json');
    expect(existsSync(newFile('auth.json'))).toBe(false);
  });

  test('migrates single file with default 0o600 mode', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(legacyFile('auth.json'), '{"version":1}');

    migrateLegacyXdgFile('auth.json');

    expect(existsSync(newFile('auth.json'))).toBe(true);
    const content = require('node:fs').readFileSync(newFile('auth.json'), 'utf8');
    expect(JSON.parse(content)).toEqual({ version: 1 });
    // Old → .bak.
    expect(existsSync(legacyFile('auth.json'))).toBe(false);
    expect(existsSync(legacyFile('auth.json') + '.bak')).toBe(true);
    // Mode 0o600 (best-effort on platforms that support it).
    const mode = require('node:fs').statSync(newFile('auth.json')).mode & 0o777;
    expect(mode & 0o077).toBe(0); // owner-only
  });

  test('skips when target already exists (no clobber)', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    require('node:fs').mkdirSync(join(home, '.elanous'), { recursive: true });
    writeFileSync(legacyFile('auth.json'), '"old"');
    writeFileSync(newFile('auth.json'), '"new"');

    migrateLegacyXdgFile('auth.json');

    const content = require('node:fs').readFileSync(newFile('auth.json'), 'utf8');
    expect(content).toBe('"new"');
    // Legacy stays untouched.
    expect(existsSync(legacyFile('auth.json'))).toBe(true);
    expect(existsSync(legacyFile('auth.json') + '.bak')).toBe(false);
  });

  test('idempotent within a process', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(legacyFile('auth.json'), '"once"');

    migrateLegacyXdgFile('auth.json');
    expect(require('node:fs').readFileSync(newFile('auth.json'), 'utf8')).toBe('"once"');

    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(legacyFile('auth.json'), '"twice"');

    migrateLegacyXdgFile('auth.json');
    expect(require('node:fs').readFileSync(newFile('auth.json'), 'utf8')).toBe('"once"');
    expect(existsSync(legacyFile('auth.json'))).toBe(true); // re-created file untouched
  });

  test('multiple files migrate independently', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(legacyFile('auth.json'), '"a"');
    writeFileSync(legacyFile('setup-answers.json'), '"s"');

    migrateLegacyXdgFile('auth.json');
    migrateLegacyXdgFile('setup-answers.json');

    expect(require('node:fs').readFileSync(newFile('auth.json'), 'utf8')).toBe('"a"');
    expect(require('node:fs').readFileSync(newFile('setup-answers.json'), 'utf8')).toBe('"s"');
  });
});

describe('migrateLegacyHomeFile (FU2 Tier 2)', () => {
  test('migrates ~/.config/monad-agent/<file> → ~/.elanous/<file>', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'monad-agent'), { recursive: true });
    writeFileSync(join(home, '.config', 'monad-agent', 'hints.json'), '"hint"');

    migrateLegacyHomeFile({
      legacyHomeRel: join('.config', 'monad-agent', 'hints.json'),
      elanousRel: 'hints.json',
    });

    expect(existsSync(join(home, '.elanous', 'hints.json'))).toBe(true);
    expect(require('node:fs').readFileSync(join(home, '.elanous', 'hints.json'), 'utf8')).toBe('"hint"');
    expect(existsSync(join(home, '.config', 'monad-agent', 'hints.json'))).toBe(false);
    expect(existsSync(join(home, '.config', 'monad-agent', 'hints.json.bak'))).toBe(true);
  });

  test('idempotent across distinct legacy roots', () => {
    require('node:fs').mkdirSync(join(home, '.config', 'monad-agent'), { recursive: true });
    require('node:fs').mkdirSync(join(home, '.config', 'elanous'), { recursive: true });
    writeFileSync(join(home, '.config', 'monad-agent', 'a.json'), '"agent"');
    writeFileSync(join(home, '.config', 'elanous', 'b.json'), '"elanous"');

    migrateLegacyHomeFile({
      legacyHomeRel: join('.config', 'monad-agent', 'a.json'),
      elanousRel: 'a.json',
    });
    migrateLegacyHomeFile({
      legacyHomeRel: join('.config', 'elanous', 'b.json'),
      elanousRel: 'b.json',
    });

    expect(require('node:fs').readFileSync(join(home, '.elanous', 'a.json'), 'utf8')).toBe('"agent"');
    expect(require('node:fs').readFileSync(join(home, '.elanous', 'b.json'), 'utf8')).toBe('"elanous"');
  });
});

describe('migrateLegacyHomeDir (FU2 Tier 3)', () => {
  test('migrates ~/.monad-agent/audit/ → ~/.elanous/audit/', () => {
    require('node:fs').mkdirSync(join(home, '.monad-agent', 'audit'), { recursive: true });
    writeFileSync(join(home, '.monad-agent', 'audit', 'control-2026-05-10.ndjson'),
      '{"ts":"2026-05-10T00:00:00Z"}\n');

    migrateLegacyHomeDir({ legacyHomeRel: join('.monad-agent', 'audit'), elanousRel: 'audit' });

    expect(existsSync(join(home, '.elanous', 'audit', 'control-2026-05-10.ndjson'))).toBe(true);
    expect(existsSync(join(home, '.monad-agent', 'audit'))).toBe(false);
    expect(existsSync(join(home, '.monad-agent', 'audit.bak'))).toBe(true);
  });

  test('skips when target dir already has files', () => {
    require('node:fs').mkdirSync(join(home, '.monad-agent', 'audit'), { recursive: true });
    require('node:fs').mkdirSync(join(home, '.elanous', 'audit'), { recursive: true });
    writeFileSync(join(home, '.monad-agent', 'audit', 'old.ndjson'), 'old');
    writeFileSync(join(home, '.elanous', 'audit', 'new.ndjson'), 'new');

    migrateLegacyHomeDir({ legacyHomeRel: join('.monad-agent', 'audit'), elanousRel: 'audit' });

    expect(existsSync(join(home, '.elanous', 'audit', 'new.ndjson'))).toBe(true);
    expect(existsSync(join(home, '.elanous', 'audit', 'old.ndjson'))).toBe(false);
    expect(existsSync(join(home, '.monad-agent', 'audit'))).toBe(true); // not stolen
  });
});
