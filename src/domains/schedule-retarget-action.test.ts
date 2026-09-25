import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSchedule } from '../index.js';
import { retargetScheduleFolders } from './schedule-retarget-action.js';

function folders(): { from: string; to: string; missing: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sched-retarget-'));
  const from = join(root, 'from');
  const to = join(root, 'to');
  mkdirSync(from);
  mkdirSync(to);
  const file = join(root, 'not-a-dir');
  writeFileSync(file, 'x');
  return {
    from,
    to,
    missing: join(root, 'missing'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('retargetScheduleFolders', () => {
  test('dry-run replaces only leading cd of the source folder and does not apply', () => {
    const { from, to, cleanup } = folders();
    try {
      const crontab = [
        `*/5 * * * * cd ${from} && bun scripts/a.ts >> /tmp/a.log 2>&1`,
        `0 8 * * * cd /other && bun scripts/b.ts`,
        `# ${from} stays in a comment`,
        `0 9 * * * echo cd ${from}`,
      ].join('\n') + '\n';
      let applied = '';
      const result = retargetScheduleFolders(
        { from, to },
        { read: () => crontab, apply: (text) => { applied = text; return '/bak'; } },
      );
      expect(applied).toBe('');
      expect(result).toMatchObject({
        dryRun: true,
        from,
        to,
        count: 1,
        changes: [{
          before: `*/5 * * * * cd ${from} && bun scripts/a.ts >> /tmp/a.log 2>&1`,
          after: `*/5 * * * * cd ${to} && bun scripts/a.ts >> /tmp/a.log 2>&1`,
        }],
      });
    } finally {
      cleanup();
    }
  });

  // 🆕 리뷰 must-fix 두 건(2026-09-24 수확) — 상대 경로 · 크론에 안전하지 않은 문자.
  test('relative --from/--to are rejected and a relative cd in the crontab never matches', () => {
    const { from, to, cleanup } = folders();
    try {
      let read = 0;
      const deps = { read: () => { read += 1; return `* * * * * cd from && x\n`; }, apply: () => '/bak' };
      expect(retargetScheduleFolders({ from: 'from', to }, deps)).toMatchObject({ error: expect.stringContaining('절대 경로') });
      expect(retargetScheduleFolders({ from, to: 'to' }, deps)).toMatchObject({ error: expect.stringContaining('절대 경로') });
      expect(read).toBe(0);
      const rel = retargetScheduleFolders({ from, to }, { read: () => `* * * * * cd from && x\n`, apply: () => '/bak' });
      expect(rel).toMatchObject({ count: 0 });
    } finally {
      cleanup();
    }
  });

  test('a destination with shell or cron metacharacters is rejected before reading the crontab', () => {
    const { from, cleanup } = folders();
    const bad = join(from, '..', 'evil;rm -rf ~');
    mkdirSync(bad);
    try {
      let read = 0;
      const result = retargetScheduleFolders({ from, to: bad }, { read: () => { read += 1; return ''; }, apply: () => '/bak' });
      expect(result).toMatchObject({ error: expect.stringContaining('안전하지 않은 문자') });
      expect(read).toBe(0);
    } finally {
      cleanup();
    }
  });

  // 🆕 2026-09-24 — 줄을 «골라» 옮긴다(R3: pilot 에 남아야 하는 줄이 있다).
  test('--only moves just the selected jobs, and an ambiguous or unknown selector changes nothing', () => {
    const { from, to, cleanup } = folders();
    try {
      const a = `*/5 * * * * cd ${from} && bun scripts/a.ts`;
      const b = `0 8 * * * cd ${from} && bun scripts/b.ts`;
      const crontab = `${a}\n${b}\n`;
      const rows = () => [
        { id: 'aaaa1111', name: 'a', raw: a },
        { id: 'bbbb2222', name: 'b', raw: b },
        { id: 'bbbb3333', name: 'b-dup', raw: 'x' },
      ];
      const picked = retargetScheduleFolders({ from, to, only: 'aaaa' }, { read: () => crontab, apply: () => '/bak', rows });
      expect(picked).toMatchObject({ count: 1, changes: [{ before: a }] });
      const ambiguous = retargetScheduleFolders({ from, to, only: 'bbbb' }, { read: () => crontab, apply: () => '/bak', rows });
      expect(ambiguous).toMatchObject({ error: expect.stringContaining('bbbb(2건)') });
      const unknown = retargetScheduleFolders({ from, to, only: 'a,zzzz' }, { read: () => crontab, apply: () => '/bak', rows });
      expect(unknown).toMatchObject({ error: expect.stringContaining('zzzz(0건)') });
    } finally {
      cleanup();
    }
  });

  test('--yes applies the rewritten crontab and returns the backup path', () => {
    const { from, to, cleanup } = folders();
    try {
      const line = `*/5 * * * * cd ${from} && bun scripts/a.ts`;
      let applied = '';
      const result = retargetScheduleFolders(
        { from, to, yes: true },
        {
          read: () => `${line}\n`,
          apply: (text) => { applied = text; return '/tmp/crontab.bak'; },
          inventory: () => {},
        },
      );
      expect(applied).toBe(`*/5 * * * * cd ${to} && bun scripts/a.ts\n`);
      expect(result).toMatchObject({ dryRun: false, count: 1, backup: '/tmp/crontab.bak' });
    } finally {
      cleanup();
    }
  });

  test('a missing destination directory is an error and does not read crontab', () => {
    const { from, missing, cleanup } = folders();
    try {
      let reads = 0;
      const result = retargetScheduleFolders(
        { from, to: missing, yes: true },
        { read: () => { reads += 1; return ''; }, apply: () => { throw new Error('must not apply'); } },
      );
      expect(reads).toBe(0);
      expect(result).toEqual({ error: `대상 폴더가 없습니다: ${missing}` });
    } finally {
      cleanup();
    }
  });

  test('a path that is not a directory is an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'sched-retarget-file-'));
    const from = join(root, 'from');
    const file = join(root, 'file');
    mkdirSync(from);
    writeFileSync(file, 'x');
    try {
      expect(retargetScheduleFolders({ from, to: file })).toEqual({
        error: `대상 경로가 디렉터리가 아닙니다: ${file}`,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing flags are an error before any folder check', () => {
    expect(retargetScheduleFolders({})).toEqual({
      error: 'retarget에는 --from <folder> 와 --to <folder> 가 필요합니다.',
    });
  });
});

describe('schedule retarget CLI', () => {
  test('runSchedule retarget surfaces a missing destination as an error exit', async () => {
    const { from, missing, cleanup } = folders();
    const output: string[] = [];
    const exitCodes: number[] = [];
    const write = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => {
      output.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      callback?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await runSchedule(
        'retarget',
        { from, to: missing, json: true },
        async () => { throw new Error('dispatch must not run'); },
        (code) => exitCodes.push(code),
      );
    } finally {
      process.stdout.write = write;
      cleanup();
    }
    expect(exitCodes).toEqual([1]);
    expect(JSON.parse(output[0]!)).toEqual({ error: `대상 폴더가 없습니다: ${missing}` });
  });
});
