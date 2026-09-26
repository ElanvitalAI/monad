import { describe, expect, test } from 'bun:test';

import { runPwaInstall } from '../src/cli/pwa-install.js';

interface CapturedOut {
  log: (s: string) => void;
  error: (s: string) => void;
  logs: string[];
  errors: string[];
}

function makeOut(): CapturedOut {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => logs.push(s),
    error: (s) => errors.push(s),
    logs,
    errors,
  };
}

describe('runPwaInstall', () => {
  test('success path — exit 0 logs the apps/pwa cwd + success line', async () => {
    const out = makeOut();
    let spawnCmd = '';
    let spawnArgs: string[] = [];
    let spawnCwd = '';
    const r = await runPwaInstall({
      cwd: '/repo/apps/pwa',
      out,
      spawnFn: async (cmd, args, cwd) => {
        spawnCmd = cmd;
        spawnArgs = args;
        spawnCwd = cwd;
        return 0;
      },
    });
    expect(r.exitCode).toBe(0);
    expect(spawnCmd).toBe('bun');
    expect(spawnArgs).toEqual(['install']);
    expect(spawnCwd).toBe('/repo/apps/pwa');
    expect(out.logs.some((l) => l.includes('elanous nexus pwa install: /repo/apps/pwa'))).toBe(true);
    expect(out.logs.some((l) => l.includes('✓ install succeeded'))).toBe(true);
  });

  test('failure path — non-zero exit surfaces error line', async () => {
    const out = makeOut();
    const r = await runPwaInstall({
      cwd: '/repo/apps/pwa',
      out,
      spawnFn: async () => 17,
    });
    expect(r.exitCode).toBe(17);
    expect(out.errors.some((e) => e.includes('✗ install failed (exit 17)'))).toBe(true);
  });

  test('durationMs is wall-clock', async () => {
    const r = await runPwaInstall({
      cwd: '/repo/apps/pwa',
      out: makeOut(),
      spawnFn: async () => {
        await new Promise((res) => setTimeout(res, 20));
        return 0;
      },
    });
    expect(r.durationMs).toBeGreaterThanOrEqual(15);
  });
});
