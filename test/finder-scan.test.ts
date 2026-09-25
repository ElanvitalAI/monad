import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  scanFinder,
  relativizeResults,
  detectFinderBackend,
} from '../src/finder/finder-scan.js';
import type { FinderScanDeps } from '../src/finder/finder-scan.js';

type Reply = { stdout: string; code?: number };

function mkSpawn(reply: Reply, opts: { killOnCap?: boolean } = {}): FinderScanDeps {
  return {
    spawnImpl: ((cmd: string, _args: string[]) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const ee = new EventEmitter() as EventEmitter & {
        stdout: PassThrough; stderr: PassThrough; kill: (sig?: NodeJS.Signals) => void;
        __killed: boolean;
      };
      ee.stdout = stdout;
      ee.stderr = stderr;
      ee.__killed = false;
      ee.kill = () => {
        ee.__killed = true;
        if (opts.killOnCap) {
          stdout.end();
          stderr.end();
          setImmediate(() => ee.emit('close', 143));
        }
      };
      setImmediate(() => {
        stdout.write(reply.stdout);
        if (!opts.killOnCap) {
          stdout.end();
          stderr.end();
          ee.emit('close', reply.code ?? 0);
        }
      });
      // Mark cmd so caller can inspect via stub state.
      (ee as unknown as { cmd: string }).cmd = cmd;
      return ee;
    }) as never,
    probeBackend: () => 'fd',
    now: () => 0,
  };
}

describe('scanFinder', () => {
  test('collects newline-separated stdout', async () => {
    const r = await scanFinder({}, mkSpawn({
      stdout: 'src/a.ts\nsrc/b.ts\nREADME.md\n',
    }));
    expect(r.paths).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(r.truncated).toBe(false);
    expect(r.backend).toBe('fd');
  });

  test('flushes a final line without trailing newline', async () => {
    const r = await scanFinder({}, mkSpawn({ stdout: 'only-file.ts' }));
    expect(r.paths).toEqual(['only-file.ts']);
  });

  test('truncates at maxFiles', async () => {
    const r = await scanFinder({ maxFiles: 2 }, mkSpawn({
      stdout: 'a\nb\nc\nd\ne\n',
    }, { killOnCap: true }));
    expect(r.paths).toEqual(['a', 'b']);
    expect(r.truncated).toBe(true);
  });

  test('errored spawn resolves with empty result', async () => {
    const deps: FinderScanDeps = {
      spawnImpl: ((_cmd: string) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const ee = new EventEmitter() as EventEmitter & {
          stdout: PassThrough; stderr: PassThrough; kill: () => void;
        };
        ee.stdout = stdout;
        ee.stderr = stderr;
        ee.kill = () => {};
        setImmediate(() => ee.emit('error', new Error('ENOENT')));
        return ee;
      }) as never,
      probeBackend: () => 'fd',
    };
    const r = await scanFinder({}, deps);
    expect(r.paths).toEqual([]);
  });

  test('find backend returns same shape', async () => {
    const r = await scanFinder({ backend: 'find' }, mkSpawn({
      stdout: './x.ts\n./y.ts\n',
    }));
    expect(r.paths).toEqual(['./x.ts', './y.ts']);
    expect(r.backend).toBe('find');
  });

  test('empty stdout yields empty paths', async () => {
    const r = await scanFinder({}, mkSpawn({ stdout: '' }));
    expect(r.paths).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  test('durationMs tracked from now fn', async () => {
    let t = 0;
    const r = await scanFinder({}, {
      ...mkSpawn({ stdout: 'x\n' }),
      now: () => (t += 5),
    });
    expect(r.durationMs).toBeGreaterThan(0);
  });
});

describe('relativizeResults', () => {
  test('strips the root prefix with trailing slash', () => {
    expect(relativizeResults(['/home/alice/a.ts', '/home/alice/b.ts'], '/home/alice'))
      .toEqual(['a.ts', 'b.ts']);
  });

  test('preserves absolute paths outside root', () => {
    expect(relativizeResults(['/etc/hosts'], '/home/alice')).toEqual(['/etc/hosts']);
  });

  test('root itself becomes .', () => {
    expect(relativizeResults(['/home/alice'], '/home/alice')).toEqual(['.']);
  });

  test('handles root with trailing slash', () => {
    expect(relativizeResults(['/home/alice/a.ts'], '/home/alice/'))
      .toEqual(['a.ts']);
  });
});

describe('detectFinderBackend', () => {
  test('returns either fd or find', () => {
    const b = detectFinderBackend();
    expect(['fd', 'find']).toContain(b);
  });
});

describe('T5-H2: fzf.zsh default argv', () => {
  test('fd: hidden ON by default + .git and node_modules excluded', async () => {
    let capturedArgs: string[] = [];
    const deps: FinderScanDeps = {
      spawnImpl: ((_cmd: string, args: string[]) => {
        capturedArgs = args;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const ee = new EventEmitter() as EventEmitter & {
          stdout: PassThrough; stderr: PassThrough; kill: () => void;
        };
        ee.stdout = stdout;
        ee.stderr = stderr;
        ee.kill = () => {};
        setImmediate(() => { stdout.end(); stderr.end(); ee.emit('close', 0); });
        return ee;
      }) as never,
      probeBackend: () => 'fd',
    };
    await scanFinder({}, deps);
    expect(capturedArgs).toContain('--hidden');
    expect(capturedArgs).toContain('.git');
    expect(capturedArgs).toContain('node_modules');
  });

  test('fd: hidden OFF when includeHidden=false', async () => {
    let capturedArgs: string[] = [];
    const deps: FinderScanDeps = {
      spawnImpl: ((_cmd: string, args: string[]) => {
        capturedArgs = args;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const ee = new EventEmitter() as EventEmitter & {
          stdout: PassThrough; stderr: PassThrough; kill: () => void;
        };
        ee.stdout = stdout;
        ee.stderr = stderr;
        ee.kill = () => {};
        setImmediate(() => { stdout.end(); stderr.end(); ee.emit('close', 0); });
        return ee;
      }) as never,
      probeBackend: () => 'fd',
    };
    await scanFinder({ includeHidden: false }, deps);
    expect(capturedArgs).not.toContain('--hidden');
    expect(capturedArgs).toContain('.git');
  });

  test('find fallback: .git + node_modules always excluded', async () => {
    let capturedArgs: string[] = [];
    const deps: FinderScanDeps = {
      spawnImpl: ((_cmd: string, args: string[]) => {
        capturedArgs = args;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const ee = new EventEmitter() as EventEmitter & {
          stdout: PassThrough; stderr: PassThrough; kill: () => void;
        };
        ee.stdout = stdout;
        ee.stderr = stderr;
        ee.kill = () => {};
        setImmediate(() => { stdout.end(); stderr.end(); ee.emit('close', 0); });
        return ee;
      }) as never,
      probeBackend: () => 'find',
    };
    await scanFinder({ backend: 'find' }, deps);
    expect(capturedArgs.join(' ')).toContain('*/.git/*');
    expect(capturedArgs.join(' ')).toContain('*/node_modules/*');
  });

  test('find fallback: dot-paths filtered only when hidden=false', async () => {
    let capturedArgs: string[] = [];
    const deps: FinderScanDeps = {
      spawnImpl: ((_cmd: string, args: string[]) => {
        capturedArgs = args;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const ee = new EventEmitter() as EventEmitter & {
          stdout: PassThrough; stderr: PassThrough; kill: () => void;
        };
        ee.stdout = stdout;
        ee.stderr = stderr;
        ee.kill = () => {};
        setImmediate(() => { stdout.end(); stderr.end(); ee.emit('close', 0); });
        return ee;
      }) as never,
      probeBackend: () => 'find',
    };
    await scanFinder({ backend: 'find', includeHidden: false }, deps);
    expect(capturedArgs.join(' ')).toContain('*/.*');
    capturedArgs = [];
    await scanFinder({ backend: 'find', includeHidden: true }, deps);
    // hidden:true → no dot-path exclusion added
    expect(capturedArgs.filter(a => a === '*/.*').length).toBe(0);
  });
});
