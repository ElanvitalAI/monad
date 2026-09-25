// End-to-end: ShellRunner dispatch → RunnerHostFactory → PtyCaptureEngine
// → OSC 133 boundary → ShellResult.
//
// We stub the PreviewTerminal (via RunnerHostFactoryOpts.terminalFactory)
// with a fake that records writes + exposes a `simulate(chunk)` method
// so we can deterministically drive the raw-tap. This exercises the
// whole dispatch pipeline without needing a real PTY.

import { describe, test, expect } from 'bun:test';

import {
  runShell,
  setShellRunnerDeps,
  resetShellRunnerDeps,
} from '../../src/shell-runner/dispatch.js';
import { createShellRegistry } from '../../src/shell-runner/registry.js';
import { createRunnerHostFactory } from '../../src/shell-runner/runner-host-factory.js';
import { createFileCaptureEngine } from '../../src/shell-runner/file-engine.js';
import type { TerminalHost } from '../../src/shell-runner/pty-engine.js';
import type { BufferMark, RunCtx, ShellRequest } from '../../src/shell-runner/types.js';

const ESC = '\x1b';
const BEL = '\x07';

function scriptableHost(): TerminalHost & {
  simulate: (chunk: string) => void;
  writes: string[];
  started: boolean;
  start: () => void;
  stop: () => void;
} {
  const taps = new Set<(c: string) => void>();
  const writes: string[] = [];
  let accumulated = '';
  let bytes = 0;
  let alive = true;
  let started = false;
  return {
    get isAlive() { return alive; },
    addRawOutputTap(cb) { taps.add(cb); return () => taps.delete(cb); },
    markBufferPosition(): BufferMark {
      return { row: accumulated.split('\n').length - 1, col: 0, ts: Date.now(), bytes };
    },
    bytesSinceMark(m) { return bytes - m.bytes; },
    sliceFromMark(m) { return [accumulated.slice(m.bytes)]; },
    renderForLLM(opts) {
      if (opts.mark) return accumulated.slice(opts.mark.bytes);
      return accumulated;
    },
    write(b) { writes.push(b); },
    resize() { /* noop */ },
    simulate(chunk) {
      accumulated += chunk;
      bytes += Buffer.byteLength(chunk, 'utf8');
      for (const t of taps) t(chunk);
    },
    start() { started = true; },
    stop() { alive = false; },
    get writes() { return writes; },
    get started() { return started; },
  } as any;
}

function makeCtx(): RunCtx {
  return { getCwd: () => '/tmp' };
}

describe('ShellRunner e2e (dispatch → factory → pty engine)', () => {
  test('mode=vw: factory spawns host, command routes through PTY engine, OSC 133 pins exit code', async () => {
    // Installed deps (parallel to what dashboard boot does).
    const registry = createShellRegistry();
    // Track which host we last spawned so we can drive it.
    let lastHost: ReturnType<typeof scriptableHost> | null = null;
    const runnerHosts = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => {
        lastHost = scriptableHost();
        return lastHost;
      },
    });
    setShellRunnerDeps({
      registry,
      fileEngine: createFileCaptureEngine(),
      ptyHostFactory: (req) => runnerHosts.factory(req),
    });

    try {
      const req: ShellRequest = {
        command: 'ls',
        mode: 'vw',
        quietIdleMs: null,
        timeoutMs: 10_000,
      };
      const handle = runShell(req, {
        registry,
        fileEngine: createFileCaptureEngine(),
        ptyHostFactory: (r) => runnerHosts.factory(r),
      }, { ctx: makeCtx() });

      expect(handle.mode).toBe('vw');
      expect(lastHost).not.toBeNull();
      expect(lastHost!.writes[0]).toBe('ls\r');
      expect(registry.get(handle.id)).toBe(handle);

      // Simulate the shell echoing + producing output + emitting
      // the OSC 133 cmd-end sentinel with exit 0.
      lastHost!.simulate('file1\nfile2\n');
      lastHost!.simulate(`${ESC}]133;B;0${BEL}`);

      const result = await handle.result;
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('exit');
      expect(result.aggregated.text).toContain('file1');
      expect(result.aggregated.text).toContain('file2');
      expect(handle.status).toBe('completed');
      // Same host is cached for the next command.
      expect(runnerHosts.list()).toHaveLength(1);
    } finally {
      resetShellRunnerDeps();
    }
  });

  test('sequential commands in same label re-use the same host + keep scrollback', async () => {
    const registry = createShellRegistry();
    let lastHost: ReturnType<typeof scriptableHost> | null = null;
    const runnerHosts = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => {
        lastHost = scriptableHost();
        return lastHost;
      },
    });

    try {
      const deps = {
        registry,
        fileEngine: createFileCaptureEngine(),
        ptyHostFactory: (r: ShellRequest) => runnerHosts.factory(r),
      };

      // First command.
      const h1 = runShell(
        { command: 'echo one', mode: 'vw', quietIdleMs: null, timeoutMs: 5000 },
        deps,
        { ctx: makeCtx() },
      );
      lastHost!.simulate('one\n');
      lastHost!.simulate(`${ESC}]133;B;0${BEL}`);
      const r1 = await h1.result;
      expect(r1.aggregated.text).toContain('one');

      // Second command — same label, same host.
      const h2 = runShell(
        { command: 'echo two', mode: 'vw', quietIdleMs: null, timeoutMs: 5000 },
        deps,
        { ctx: makeCtx() },
      );
      // bookmark slices from here; prior output is preserved
      // in the host's accumulated state but not in h2's slice.
      lastHost!.simulate('two\n');
      lastHost!.simulate(`${ESC}]133;B;0${BEL}`);
      const r2 = await h2.result;
      expect(r2.aggregated.text).toContain('two');
      expect(r2.aggregated.text).not.toContain('one');
      // Both handles are in the registry.
      expect(registry.list()).toHaveLength(2);
      expect(runnerHosts.list()).toHaveLength(1);
    } finally {
      resetShellRunnerDeps();
    }
  });

  test('different labels → different hosts', async () => {
    const registry = createShellRegistry();
    const spawns: string[] = [];
    const runnerHosts = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: (label) => { spawns.push(label); return scriptableHost(); },
    });
    try {
      const deps = {
        registry,
        fileEngine: createFileCaptureEngine(),
        ptyHostFactory: (r: ShellRequest) => runnerHosts.factory(r),
      };
      runShell({ command: 'a', mode: 'vw', timeoutMs: 5000 }, deps, { ctx: makeCtx() });
      runShell({
        command: 'b', mode: 'vw', vw: { windowLabel: 'deploy' }, timeoutMs: 5000,
      }, deps, { ctx: makeCtx() });
      expect(spawns).toEqual(['runner', 'deploy']);
    } finally {
      resetShellRunnerDeps();
    }
  });

  test('quiet-idle fallback when OSC 133 is absent', async () => {
    const registry = createShellRegistry();
    let lastHost: ReturnType<typeof scriptableHost> | null = null;
    const runnerHosts = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      terminalFactory: () => (lastHost = scriptableHost(), lastHost),
    });

    try {
      const deps = {
        registry,
        fileEngine: createFileCaptureEngine(),
        ptyHostFactory: (r: ShellRequest) => runnerHosts.factory(r),
      };
      const h = runShell(
        { command: 'silent', mode: 'vw', quietIdleMs: 50, timeoutMs: 5000 },
        deps,
        { ctx: makeCtx() },
      );
      lastHost!.simulate('output\n');
      // Wait longer than quietIdleMs for the fallback to fire.
      await new Promise(r => setTimeout(r, 150));
      const result = await h.result;
      expect(result.aggregated.text).toContain('output');
      expect(result.exitCode).toBeUndefined();
      expect(result.outcome).toBe('exit');
    } finally {
      resetShellRunnerDeps();
    }
  });

  test('factory null → file engine fallback (no host spawned)', async () => {
    const registry = createShellRegistry();
    setShellRunnerDeps({
      registry,
      fileEngine: createFileCaptureEngine({
        spawnFn: ((_cmd: string) => {
          const { EventEmitter } = require('node:events');
          const { PassThrough } = require('node:stream');
          const ee = new EventEmitter() as any;
          ee.stdout = new PassThrough();
          ee.stderr = new PassThrough();
          ee.stdin = new PassThrough();
          ee.kill = () => true;
          queueMicrotask(() => {
            ee.stdout.write('from-file-engine\n');
            ee.stdout.end();
            ee.stderr.end();
            ee.emit('exit', 0, null);
          });
          return ee;
        }) as any,
      }),
      ptyHostFactory: () => null, // always fails → fallback to file
    });

    try {
      const handle = runShell(
        { command: 'echo', mode: 'vw', timeoutMs: 1000 },
        {
          registry,
          fileEngine: createFileCaptureEngine(),
          ptyHostFactory: () => null,
        },
        { ctx: makeCtx() },
      );
      expect(handle.mode).toBe('vw'); // mode preserved
      // But the engine was file — no host was spawned.
      // The result completes via file engine's exit event.
      const r = await handle.result;
      expect(r.outcome).toBe('exit');
    } finally {
      resetShellRunnerDeps();
    }
  });
});
