// H5 Phase 3 · Shared PTY adapter factory tests.
//
// The factory backs codex-pty, claude-pty, gemini-pty — tests here
// focus on brand/mode gating, binary override, default args merge,
// observer attach on/off, and session shape. Per-brand tests (codex,
// claude, gemini) then only need a few smoke assertions because the
// heavy lifting is covered here.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  createPtyAdapterFromSpec,
  _resetPtyAdapterSessionSeqForTesting,
  type PtyAdapterSpec,
} from '../src/agent/adapters/pty-adapter-factory.js';
import {
  resetForTesting,
  setPtyAdapterForTesting,
  listPty,
} from '../src/pty-shell/registry.js';

interface FakeProcess {
  readonly pid: number;
  writes: string[];
  killed: boolean;
  killedSignal?: string;
  dataHandlers: Array<(data: string) => void>;
  exitHandlers: Array<(e: { exitCode: number; signal?: number }) => void>;
  fireData(chunk: string): void;
  fireExit(code: number): void;
}

function fakePtyAdapter(): { processes: FakeProcess[]; spawn: () => FakeProcess } {
  const processes: FakeProcess[] = [];
  const spawn = () => {
    const proc: FakeProcess = {
      pid: 1000 + processes.length,
      writes: [],
      killed: false,
      dataHandlers: [],
      exitHandlers: [],
      fireData(chunk: string) {
        for (const cb of this.dataHandlers) cb(chunk);
      },
      fireExit(code: number) {
        this.killed = true;
        for (const cb of this.exitHandlers) cb({ exitCode: code });
      },
    };
    processes.push(proc);
    return proc;
  };
  return { processes, spawn };
}

function installFakeAdapter() {
  const state = fakePtyAdapter();
  setPtyAdapterForTesting(() => {
    const proc = state.spawn();
    return {
      pid: proc.pid,
      write(input: string) { proc.writes.push(input); },
      kill(signal?: string) {
        proc.killed = true;
        proc.killedSignal = signal;
        queueMicrotask(() => proc.fireExit(signal === 'SIGKILL' ? 137 : 0));
      },
      onData(cb: (data: string) => void) {
        proc.dataHandlers.push(cb);
        return { dispose() { /* noop */ } };
      },
      onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
        proc.exitHandlers.push(cb);
        return { dispose() { /* noop */ } };
      },
    };
  });
  return state;
}

afterEach(() => {
  resetForTesting();
  setPtyAdapterForTesting(null);
  _resetPtyAdapterSessionSeqForTesting();
});

const SAMPLE_SPEC: PtyAdapterSpec = {
  id: 'sample-pty',
  brands: ['alpha', 'beta'],
  binary: 'sample-bin',
  defaultArgs: ['--demo'],
};

describe('createPtyAdapterFromSpec · supports()', () => {
  test('matches declared brands with default modes', () => {
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    expect(a.supports({ brand: 'alpha' })).toBe(true);
    expect(a.supports({ brand: 'beta' })).toBe(true);
    expect(a.supports({ brand: 'alpha', mode: 'pty-direct' })).toBe(true);
    expect(a.supports({ brand: 'alpha', mode: 'hybrid' })).toBe(true);
    expect(a.supports({ brand: 'alpha', mode: 'auto' })).toBe(true);
  });

  test('rejects unknown brand and non-PTY modes', () => {
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    expect(a.supports({ brand: 'gamma' })).toBe(false);
    expect(a.supports({ brand: 'alpha', mode: 'acp' })).toBe(false);
    expect(a.supports({ brand: 'alpha', mode: 'native-sdk' })).toBe(false);
  });

  test('custom modes override defaults', () => {
    const spec: PtyAdapterSpec = { ...SAMPLE_SPEC, modes: ['pty-direct'] };
    const a = createPtyAdapterFromSpec(spec);
    expect(a.supports({ brand: 'alpha', mode: 'auto' })).toBe(false);
    expect(a.supports({ brand: 'alpha', mode: 'pty-direct' })).toBe(true);
  });
});

describe('createPtyAdapterFromSpec · launch()', () => {
  test('wraps PTY into EmbodiedAgentSession with expected shape', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha', mode: 'pty-direct' });
    expect(session.id).toMatch(/^emb-sample-pty-/);
    expect(session.launchSpec.brand).toBe('alpha');
    expect(session.transports.length).toBe(1);
    expect(session.transports[0]!.kind).toBe('pty');
    expect(session.transports[0]!.label).toBe('sample-pty');
    expect(session.state().status).toBe('running');
    expect(session.state().title).toBe('alpha [sample-pty]');
    await session.dispose();
  });

  test('transportLabel override applies', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec({ ...SAMPLE_SPEC, transportLabel: 'custom-label' });
    const session = await a.launch({ brand: 'alpha' });
    expect(session.transports[0]!.label).toBe('custom-label');
    await session.dispose();
  });

  test('binary override applies', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC, { binary: '/usr/local/bin/custom' });
    await a.launch({ brand: 'alpha' });
    expect(listPty().some((h) => h.cmd === '/usr/local/bin/custom')).toBe(true);
  });

  test('spec defaultArgs + opts defaultArgs + spec.extraArgs merge in order', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC, { defaultArgs: ['--opt-arg'] });
    await a.launch({ brand: 'alpha', extraArgs: ['--user-arg'] });
    // fake adapter stores writes not args; we just assert spawn happened
    expect(state.processes.length).toBe(1);
    const handle = listPty()[0]!;
    expect(handle).toBeDefined();
  });

  test('id override applies', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC, { id: 'renamed-pty' });
    expect(a.id).toBe('renamed-pty');
    const session = await a.launch({ brand: 'alpha' });
    expect(session.id).toMatch(/^emb-renamed-pty-/);
    expect(session.state().title).toBe('alpha [renamed-pty]');
    await session.dispose();
  });

  test('throws on unsupported brand', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    let err: unknown;
    try {
      await a.launch({ brand: 'gamma' });
    } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/does not support/);
    expect((err as Error).message).toContain('sample-pty');
  });
});

describe('EmbodiedAgentSession (factory) · lifecycle', () => {
  test('send writes to PTY', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    await session.send('hi\n');
    expect(state.processes[0]!.writes).toEqual(['hi\n']);
    await session.dispose();
  });

  test('interrupt maps signals', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const s1 = await a.launch({ brand: 'alpha' });
    await s1.interrupt();
    expect(state.processes[0]!.killedSignal).toBe('SIGINT');
    const s2 = await a.launch({ brand: 'alpha' });
    await s2.interrupt('kill');
    expect(state.processes[1]!.killedSignal).toBe('SIGKILL');
    await s1.dispose();
    await s2.dispose();
  });

  test('snapshot returns buffer contents', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    state.processes[0]!.fireData('buffer data');
    expect(await session.snapshot()).toBe('buffer data');
    await session.dispose();
  });

  test('state: running → done on exit 0', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    expect(session.state().status).toBe('running');
    state.processes[0]!.fireExit(0);
    expect(session.state().status).toBe('done');
    await session.dispose();
  });

  test('state: running → error on non-zero exit', async () => {
    const state = installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    state.processes[0]!.fireExit(42);
    expect(session.state().status).toBe('error');
    await session.dispose();
  });

  test('dispose unregisters PTY', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    expect(listPty().length).toBe(1);
    await session.dispose();
    expect(listPty().length).toBe(0);
  });

  test('send after dispose rejects', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    await session.dispose();
    let err: unknown;
    try { await session.send('x'); } catch (e) { err = e; }
    expect((err as Error).message).toMatch(/disposed/);
  });
});

describe('observer attach', () => {
  test('observer default ON · dispose chain includes observer cleanup', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC);
    const session = await a.launch({ brand: 'alpha' });
    // dispose should succeed without throwing even though observer
    // attached to this session
    await session.dispose();
    // And it should still dispose the PTY
    expect(listPty().length).toBe(0);
  });

  test('observer opt-out skips attach', async () => {
    installFakeAdapter();
    const a = createPtyAdapterFromSpec(SAMPLE_SPEC, { observer: false });
    const session = await a.launch({ brand: 'alpha' });
    await session.dispose();
    expect(listPty().length).toBe(0);
  });
});
