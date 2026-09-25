import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  setPtyManifestDbPathForTesting,
  upsertPtyManifest,
} from '../../src/pty-shell/pty-manifest.js';

const homes: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'monad-pty-list-wal-'));
  homes.push(home);
  setPtyManifestDbPathForTesting(join(home, '.monad', 'pty', 'manifest.db'));
});

afterAll(() => {
  setPtyManifestDbPathForTesting(null);
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe('monad pty list --all --include-test WAL visibility', () => {
  test('separate CLI process lists a fresh frame-less live registration before checkpoint', () => {
    const id = 'pty_fresh_wal_cli';
    const now = Date.now();
    upsertPtyManifest({ id, kind: 'tui', cmd: 'monad', startedAt: now, now, ptyPid: process.pid });

    const home = homes.at(-1)!;
    const result = spawnSync(process.execPath, ['bin/monad.mjs', 'pty', 'list', '--all', '--include-test'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, MONAD_STATE_DIR: join(home, '.monad') },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(id);
  });
});
