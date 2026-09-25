// H5 Phase 1 Step D · pty-binding primitive tests.
//
// Uses pty-shell's `setPtyAdapterForTesting` seam to inject a synthetic
// PTY so tests don't require the node-pty native binding.

import { describe, test, expect, afterEach } from 'bun:test';
import { bindAgentToVW } from '../src/agent/pty-binding.js';
import {
  resetForTesting,
  setPtyAdapterForTesting,
} from '../src/pty-shell/registry.js';

interface CapturedSpawn {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  name: string;
}

function fakeAdapter(captured: CapturedSpawn[]) {
  return (opts: Parameters<Parameters<typeof setPtyAdapterForTesting>[0] & object>[0]) => {
    captured.push({
      cmd: opts.cmd,
      args: opts.args ? [...opts.args] : undefined,
      cwd: opts.workdir,
      env: opts.env,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      name: opts.term ?? 'xterm-256color',
    });
    const listeners: Array<(data: string) => void> = [];
    const exits: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    return {
      pid: 9999,
      write() {},
      kill() {
        queueMicrotask(() => exits.forEach((cb) => cb({ exitCode: 0 })));
      },
      onData(cb: (data: string) => void) {
        listeners.push(cb);
        return { dispose() { /* noop */ } };
      },
      onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
        exits.push(cb);
        return { dispose() { /* noop */ } };
      },
    };
  };
}

afterEach(() => {
  resetForTesting();
  setPtyAdapterForTesting(null);
});

describe('bindAgentToVW', () => {
  test('spawns with binary + args + cwd + env', () => {
    const captured: CapturedSpawn[] = [];
    setPtyAdapterForTesting(fakeAdapter(captured));
    const bound = bindAgentToVW({
      binary: 'codex',
      args: ['--profile', 'fast'],
      cwd: '/tmp',
      env: { FOO: 'bar' },
    });
    expect(bound.ptyHandle.cmd).toBe('codex');
    expect(captured.length).toBe(1);
    expect(captured[0]!.cmd).toBe('codex');
    expect(captured[0]!.args).toEqual(['--profile', 'fast']);
    expect(captured[0]!.cwd).toBe('/tmp');
    expect(captured[0]!.env?.FOO).toBe('bar');
  });

  test('paneId echoed on BoundAgent · not passed to PTY', () => {
    const captured: CapturedSpawn[] = [];
    setPtyAdapterForTesting(fakeAdapter(captured));
    const bound = bindAgentToVW({
      binary: 'codex',
      paneId: 'pane-7',
    });
    expect(bound.paneId).toBe('pane-7');
    // paneId is not a PTY-adapter concern · ensure it didn't leak
    expect(captured[0]!).not.toHaveProperty('paneId');
  });

  test('term + cols + rows forwarded', () => {
    const captured: CapturedSpawn[] = [];
    setPtyAdapterForTesting(fakeAdapter(captured));
    bindAgentToVW({
      binary: 'codex',
      term: 'xterm-256color',
      cols: 120,
      rows: 40,
    });
    expect(captured[0]!.name).toBe('xterm-256color');
    expect(captured[0]!.cols).toBe(120);
    expect(captured[0]!.rows).toBe(40);
  });

  test('default detach=true · agent session survives skill-runner returns', () => {
    const captured: CapturedSpawn[] = [];
    setPtyAdapterForTesting(fakeAdapter(captured));
    const bound = bindAgentToVW({ binary: 'codex' });
    expect(bound.ptyHandle.detach).toBe(true);
  });

  test('explicit detach=false honored', () => {
    const captured: CapturedSpawn[] = [];
    setPtyAdapterForTesting(fakeAdapter(captured));
    const bound = bindAgentToVW({ binary: 'codex', detach: false });
    expect(bound.ptyHandle.detach).toBe(false);
  });
});
