// scanFinder kind:'dir' — Alt+C directory finder backing scan.
// Mirrors zshrc FZF_ALT_C_COMMAND="fd --type=d --hidden …".

import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { scanFinder } from '../src/finder/finder-scan.js';
import type { FinderScanDeps } from '../src/finder/finder-scan.js';

interface CapturedSpawn {
  cmd: string;
  args: string[];
}

function mkCapturingSpawn(reply: string): {
  deps: FinderScanDeps;
  captured: CapturedSpawn[];
} {
  const captured: CapturedSpawn[] = [];
  const deps: FinderScanDeps = {
    spawnImpl: ((cmd: string, args: string[]) => {
      captured.push({ cmd, args });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const ee = new EventEmitter() as EventEmitter & {
        stdout: PassThrough; stderr: PassThrough; kill: () => void;
      };
      ee.stdout = stdout;
      ee.stderr = stderr;
      ee.kill = () => {};
      setImmediate(() => {
        stdout.write(reply);
        stdout.end();
        stderr.end();
        ee.emit('close', 0);
      });
      return ee;
    }) as never,
    probeBackend: () => 'fd',
    now: () => 0,
  };
  return { deps, captured };
}

describe('scanFinder kind:"dir"', () => {
  test('fd backend uses --type d', async () => {
    const { deps, captured } = mkCapturingSpawn('src\nsrc/dashboard\nplugins\n');
    const r = await scanFinder({ root: '/repo', kind: 'dir' }, deps);
    expect(r.paths).toEqual(['src', 'src/dashboard', 'plugins']);
    expect(r.backend).toBe('fd');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.cmd).toBe('fd');
    // The argv contains '--type d' (not '--type f') — confirms the
    // directory-mode contract.
    const argv = captured[0]!.args;
    const typeIdx = argv.indexOf('--type');
    expect(typeIdx).toBeGreaterThanOrEqual(0);
    expect(argv[typeIdx + 1]).toBe('d');
    // Excludes preserved.
    expect(argv).toContain('--exclude');
    expect(argv).toContain('.git');
    expect(argv).toContain('node_modules');
  });

  test('find backend uses -type d', async () => {
    const { deps, captured } = mkCapturingSpawn('/repo/src\n/repo/plugins\n');
    const r = await scanFinder(
      { root: '/repo', kind: 'dir', backend: 'find' },
      deps,
    );
    expect(r.paths).toEqual(['/repo/src', '/repo/plugins']);
    expect(r.backend).toBe('find');
    const argv = captured[0]!.args;
    const typeIdx = argv.indexOf('-type');
    expect(typeIdx).toBeGreaterThanOrEqual(0);
    expect(argv[typeIdx + 1]).toBe('d');
  });

  test('default kind is "file" (regression — preserves existing behavior)', async () => {
    const { deps, captured } = mkCapturingSpawn('a.ts\n');
    await scanFinder({ root: '/repo' }, deps);
    const argv = captured[0]!.args;
    const typeIdx = argv.indexOf('--type');
    expect(argv[typeIdx + 1]).toBe('f');
  });
});
