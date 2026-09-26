import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stateDir = mkdtempSync(join(tmpdir(), 'pty-snapshot-manifest-'));
let manifestDbPath = '';

const { registerPtyTakeoverCommands, runPtySnapshot } = await import('../../src/cli/pty-takeover-cli.js');
const { upsertPtyManifest, updatePtyManifestFrame, ptyManifestDbPath, setPtyManifestDbPathForTesting } = await import('../../src/pty-shell/pty-manifest.js');
const { requestRemotePtyControl, processPtyControlRequests, resetPtyControlIpcForTesting } = await import('../../src/pty-shell/pty-control-ipc.js');
const { registerPtyControlTarget, resetForTesting, setPtyAdapterForTesting, startPty } = await import('../../src/pty-shell/registry.js');

beforeEach(() => {
  manifestDbPath = join(mkdtempSync(join(stateDir, 'store-')), 'pty', 'manifest.db');
  setPtyManifestDbPathForTesting(manifestDbPath);
  resetPtyControlIpcForTesting();
});
afterEach(() => { resetPtyControlIpcForTesting(); resetForTesting(); });
afterAll(() => {
  setPtyManifestDbPathForTesting(null);
  rmSync(stateDir, { recursive: true, force: true });
});

function seedManifest(id: string, now: number): void {
  upsertPtyManifest({ id, kind: 'tui', cmd: 'elanous', startedAt: now, now });
  expect(ptyManifestDbPath()).toBe(manifestDbPath);
  const store = new Database(manifestDbPath, { readonly: true });
  expect(store.query('SELECT id FROM pty_manifest WHERE id=?').get(id)).toEqual({ id });
  store.close();
}

/** A real control target that registers exactly like `tui-self-report` does — **no renderScreen**.
 *  The owner-side IPC processor must itself decide `screen-unavailable` from this row; the test
 *  never injects that result. */
function seedRenderlessOwner(id: string): void {
  registerPtyControlTarget({
    id,
    accessMode: 'auto',
    transitionPolicy: 'open',
    setAccessMode: () => true,
    isAlive: () => true,
    canWrite: () => false,
    write() {},
    resize() {},
  });
}

/** Drive the genuine remote round-trip: `requestRemotePtyControl` enqueues the request (this process
 *  is the owner_pid), then the real `processPtyControlRequests` settles it from the registered target.
 *  No result is injected — production code alone produces `screen-unavailable`. */
function remoteViaIpc(id: string, drive: boolean) {
  return {
    getPty: () => undefined,
    requestPtyTakeover: () => false,
    async requestRemote(rid: string, action: 'takeover' | 'release' | 'input-text' | 'input-key' | 'resize' | 'snapshot', payload?: unknown, opts?: { actor?: 'human' | 'agent'; timeoutMs?: number }) {
      const p = requestRemotePtyControl(rid, action, payload as never, { ...(opts ?? {}), timeoutMs: drive ? 10_000 : 300 });
      if (drive) {
        await Bun.sleep(30);
        await processPtyControlRequests((await import('../../src/pty-shell/registry.js')).getPtyControlTarget, () => false);
      }
      return p;
    },
    listRefs: () => [{ id, kind: 'tui', source: 'remote' as const, alive: true }],
    log() {},
  };
}

test('snapshot reads a self-reported manifest frame after the owner IPC decides screen-unavailable', async () => {
  const id = 'tui:58092';
  const frameAt = 1_234_567;
  seedManifest(id, frameAt);
  seedRenderlessOwner(id);
  updatePtyManifestFrame(id, () => 'PROBE_MARKER_A4', frameAt);

  const result = await runPtySnapshot(id, remoteViaIpc(id, true));

  expect(result).toEqual({
    exitCode: 0,
    message: `PtyShellSnapshot process_id=${id} status=running source=frame fallback=render-unavailable frame_at=${frameAt}\nPROBE_MARKER_A4`,
  });
});

test('snapshot forwards --ansi through the remote IPC render request', async () => {
  const id = 'tui:ansi-remote';
  seedManifest(id, 2_000_000);
  const calls: unknown[] = [];
  registerPtyControlTarget({
    id,
    accessMode: 'auto',
    transitionPolicy: 'open',
    setAccessMode: () => true,
    isAlive: () => true,
    canWrite: () => false,
    write() {},
    resize() {},
    renderScreen: async (options) => options?.ansi ? '\u001b[31mRED\u001b[0m' : 'RED',
  });
  const deps = remoteViaIpc(id, true);
  const requestRemote = deps.requestRemote;
  deps.requestRemote = async (...args) => { calls.push(args[2]); return requestRemote(...args); };

  const result = await runPtySnapshot(id, deps, true);

  expect(calls).toEqual([{ ansi: true }]);
  expect(result).toEqual({
    exitCode: 0,
    message: `PtyShellSnapshot process_id=${id} status=running source=live\n\u001b[31mRED\u001b[0m`,
  });
});

test('CLI pty snapshot --ansi crosses IPC to the owner renderer and preserves its styled screen', async () => {
  const id = 'pty_a11ce001';
  seedManifest(id, 2_000_010);
  let emit: (chunk: string) => void = () => {};
  setPtyAdapterForTesting(() => ({
    pid: 7, write() {}, kill() {},
    onData(listener: (chunk: string) => void) { emit = listener; return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
  }));
  const owner = startPty({ id, cmd: 'test', cols: 20, rows: 2, detach: true });
  emit('\u001b[1;31mCLI_RED');
  await owner.renderScreen();
  const ownerCalls: unknown[] = [];
  const ownerRender = owner.renderScreen.bind(owner);
  owner.renderScreen = async (options) => { ownerCalls.push(options); return ownerRender(options); };
  const stdout = process.stdout.write;
  const messages: string[] = [];
  process.stdout.write = ((chunk: string) => { messages.push(chunk); return true; }) as typeof process.stdout.write;
  try {
    const program = new Command();
    registerPtyTakeoverCommands(program, {
      getPty: () => undefined,
      requestPtyTakeover: () => false,
      async requestRemote(rid, action, payload, options) {
        const pending = requestRemotePtyControl(rid, action, payload, { ...(options ?? {}), timeoutMs: 10_000 });
        await Bun.sleep(30);
        await processPtyControlRequests((await import('../../src/pty-shell/registry.js')).getPtyControlTarget, () => false);
        return pending;
      },
      listRefs: () => [{ id, kind: 'tui', source: 'remote', alive: true }],
      log() {},
    });
    await program.parseAsync(['node', 'elanous', 'pty', 'snapshot', id, '--ansi']);
  } finally {
    process.stdout.write = stdout;
  }

  expect(ownerCalls).toEqual([{ ansi: true }]);
  expect(messages.join('')).toContain(`PtyShellSnapshot process_id=${id} status=running source=live\n[screen 20x2 cursor=(row 0, col 7, visible true)]\n\u001b[1;31mCLI_RED\u001b[0m`);
}, 15_000);

test('registry batches UTF-8 output bytes into the manifest with the snapshot flush', async () => {
  const state = mkdtempSync(join(tmpdir(), 'pty-output-bytes-'));
  const id = 'pty_a11ce002';
  const script = `
    import { getPtyManifest } from ${JSON.stringify(`${process.cwd()}/src/pty-shell/pty-manifest.ts`)};
    import { setPtyAdapterForTesting, startPty } from ${JSON.stringify(`${process.cwd()}/src/pty-shell/registry.ts`)};
    let emit = () => {};
    setPtyAdapterForTesting(() => ({
      pid: process.pid, write() {}, kill() {},
      onData(listener) { emit = listener; return { dispose() {} }; },
      onExit() { return { dispose() {} }; },
    }));
    startPty({ id: ${JSON.stringify(id)}, cmd: 'test', detach: true });
    emit('한');
    const first = getPtyManifest(${JSON.stringify(id)}).outputBytesTotal;
    emit('글');
    // 스냅샷 throttle(1500ms) 안이라 이 시점엔 아직 안 실려 있다 — 그것은 «지연»이지 «손실»이 아니다.
    const throttled = getPtyManifest(${JSON.stringify(id)}).outputBytesTotal;
    // ⭐ 그리고 재시도 예약(100ms)이 뒤늦게 «반드시» 싣는다. 이 줄이 이 테스트의 본체다 —
    //   예약이 없으면 PTY 가 조용해진 뒤 그 바이트가 영영 안 실려 총합이 «영구 과소»가 된다.
    await new Promise(r => setTimeout(r, 400));
    const settled = getPtyManifest(${JSON.stringify(id)}).outputBytesTotal;
    console.log(JSON.stringify({ first, throttled, settled }));
    process.exit(0);
  `;
  try {
    const child = Bun.spawn(['bun', '--eval', script], { env: { ...process.env, NODE_ENV: 'production', ELANOUS_STATE_DIR: state }, stdout: 'pipe' });
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
      first: Buffer.byteLength('한', 'utf8'),
      throttled: Buffer.byteLength('한', 'utf8'),
      // ⛔ 여기가 회귀 방어선 — 두 chunk 가 «모두» 실려야 한다(3 이 아니라 6).
      settled: Buffer.byteLength('한글', 'utf8'),
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}, 15_000);

test('snapshot reports owner-unavailable and frame-unavailable when the owner never responds', async () => {
  const id = 'tui:owner-no-frame';
  seedManifest(id, 2_000_001);

  // No owner processor runs → requestRemotePtyControl genuinely times out → owner-unreachable.
  const result = await runPtySnapshot(id, remoteViaIpc(id, false));

  expect(result).toEqual({
    exitCode: 1,
    message: `pty snapshot: failed for ${id} (reason=screen-unavailable cause=owner-unavailable frame=unavailable)`,
  });
});

test('snapshot reports render-unavailable and frame-unavailable for a local handle without a renderer', async () => {
  const id = 'tui:local-no-renderer-no-frame';
  seedManifest(id, 2_000_002);
  const handle = {
    id,
    accessMode: 'auto' as const,
    transitionPolicy: 'open' as const,
    setAccessMode: () => true,
    isAlive: () => true,
    canWrite: () => false,
    write() {},
    resize() {},
  };

  const result = await runPtySnapshot(id, {
    getPty: (candidate: string) => candidate === id ? handle : undefined,
    requestPtyTakeover: () => false,
    requestRemote: async () => ({ status: 'failed' as const }),
    listRefs: () => [{ id, kind: 'tui', source: 'local' as const, alive: true }],
    log() {},
  });

  expect(result).toEqual({
    exitCode: 1,
    message: `pty snapshot: failed for ${id} (reason=screen-unavailable cause=render-unavailable frame=unavailable)`,
  });
});

test('snapshot reports a missing manifest frame after the owner IPC decides screen-unavailable', async () => {
  const id = 'tui:remote-render-no-frame';
  seedManifest(id, 2_000_003);
  seedRenderlessOwner(id);

  const result = await runPtySnapshot(id, remoteViaIpc(id, true));

  expect(result).toEqual({
    exitCode: 1,
    message: `pty snapshot: failed for ${id} (reason=screen-unavailable cause=render-unavailable frame=unavailable)`,
  });
});
