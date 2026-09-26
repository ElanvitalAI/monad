import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'collect-market-daily.sh');
const homes: string[] = [];

async function createHome(withDatabase: boolean, collectorExit = 0): Promise<{ home: string; db: string; python: string }> {
  const home = await mkdtemp(join(tmpdir(), 'collect-market-daily-'));
  homes.push(home);
  const skill = join(home, '.claude/skills/apify-x-asset-sentiment');
  const scripts = join(skill, 'scripts');
  const data = join(skill, 'data');
  await mkdir(scripts, { recursive: true });
  if (withDatabase) await mkdir(data, { recursive: true });
  const db = join(data, 'x_asset.db');
  if (withDatabase) await writeFile(db, 'fixture');
  await writeFile(join(scripts, 'yahoo_fetch_daily.py'), [
    '#!/bin/zsh',
    'expected="${0:h:h}/data/x_asset.db"',
    '[[ "$1" == "--db" && "$2" == "$expected" ]] || exit 91',
    `exit ${collectorExit}`,
  ].join('\n'));
  return { home, db, python: '/bin/zsh' };
}

async function run(home: string, python: string): Promise<Bun.Subprocess> {
  return Bun.spawn(['zsh', script], {
    cwd: import.meta.dir,
    env: { ...process.env, HOME: home, PY: python },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
});

describe('collect-market-daily.sh', () => {
  test('derives SK/data/x_asset.db, passes it via --db, and preserves the daily log path', async () => {
    const { home, python } = await createHome(true);
    const process = await run(home, python);
    expect(await process.exited).toBe(0);
    expect(await new Response(process.stderr as ReadableStream).text()).toBe('');
    const logDir = join(home, '.elanous/logs/collect');
    const logs = await Array.fromAsync(new Bun.Glob('daily-*.log').scan({ cwd: logDir }));
    expect(logs).toHaveLength(1);
    const log = await Bun.file(join(logDir, logs[0]!)).text();
    expect(log).toContain('daily start');
    expect(log).toContain('daily done (rc=0)');
  });

  test('names a missing SK-derived target database and exits nonzero', async () => {
    const { home, db, python } = await createHome(false);
    const process = await run(home, python);
    expect(await process.exited).not.toBe(0);
    const stderr = await new Response(process.stderr as ReadableStream).text();
    expect(stderr).toContain(`daily collection failed: target database missing: ${db}`);
  });

  test('names and propagates collector failure with a nonzero exit', async () => {
    const { home, python } = await createHome(true, 7);
    const process = await run(home, python);
    expect(await process.exited).toBe(7);
    const stderr = await new Response(process.stderr as ReadableStream).text();
    expect(stderr).toContain('daily collection failed: collector exited rc=7');
  });
});
