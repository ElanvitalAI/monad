import { describe, expect, test, beforeEach } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import {
  TerminalRegistry,
  initTerminalMatrix,
  resetTerminalMatrix,
} from '../../src/terminal-matrix/index.js';
import {
  dispatchTerminalMatrixList,
  dispatchTerminalMatrixMove,
  dispatchTerminalMatrixSpawn,
  dispatchTerminalBroadcastSend,
  dispatchTerminalMatrixGroupJoin,
  dispatchTerminalMatrixGroupLeave,
  dispatchTerminalChannelPublish,
  dispatchTerminalReadonlySet,
  dispatchTerminalRecharacter,
} from '../../src/skills/tools/terminal-matrix.js';

function fakePreviewFactory(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  const writes: string[] = [];
  const p = {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (b: string) => writes.push(b),
    resize: () => {},
    render: () => '',
    cursorPosition: () => null,
    get isAlive(): boolean { return alive; },
    get cols(): number { return opts.cols; },
    get rows(): number { return opts.rows; },
    get pid(): number { return 1; },
    get isScrolledBack(): boolean { return false; },
    get scrollbackOffset(): number { return 0; },
    get wantsMouse(): boolean { return false; },
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
    _writes: writes,
  } as unknown as PreviewTerminal;
  return p;
}

function boot() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: fakePreviewFactory,
  });
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
  });
  initTerminalMatrix(matrix);
  return { matrix, sessions };
}

describe('Terminal matrix LLM tools', () => {
  beforeEach(() => { resetTerminalMatrix(); });

  test('MatrixSpawn + MatrixList round-trip', async () => {
    boot();
    const spawned = await dispatchTerminalMatrixSpawn({ title: 'a', cwd: '/tmp' });
    expect(spawned.output).toContain('TerminalMatrixSpawn: term:');
    const listed = await dispatchTerminalMatrixList({});
    expect(listed.output).toContain('1 matches');
    expect(listed.output).toContain('title="a"');
  });

  test('MatrixList filters by transport kind', async () => {
    boot();
    await dispatchTerminalMatrixSpawn({ title: 'local', cwd: '/tmp' });
    await dispatchTerminalMatrixSpawn({ title: 'ts', cwd: '/tmp', transport: 'tailscale:node-a' });
    const remote = await dispatchTerminalMatrixList({ transport: 'tailscale' });
    expect(remote.output).toContain('1 matches');
    expect(remote.output).toContain('title="ts"');
  });

  test('MatrixMove → background', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const r = await dispatchTerminalMatrixMove({ id: inst.id, placement: 'background' });
    expect(r.output).toContain(`${inst.id} → background`);
    expect(inst.placement.kind).toBe('background');
  });

  test('MatrixMove rejects invalid placement', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const r = await dispatchTerminalMatrixMove({ id: inst.id, placement: 'orbit' });
    expect(r.output).toContain('invalid placement');
  });

  test('MatrixMove with vw:<w>/<s> parses correctly', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    matrix.registerTransitionAdapter({
      name: 'test-vw',
      canHandle: (_, to) => to.kind === 'vw',
      apply: () => {},
    });
    const r = await dispatchTerminalMatrixMove({ id: inst.id, placement: 'vw:win1/slot2' });
    expect(r.output).toContain('→ vw:win1/slot2');
    expect(inst.placement).toEqual({ kind: 'vw', windowId: 'win1', slotId: 'slot2' });
  });

  test('GroupJoin + BroadcastSend + GroupLeave', async () => {
    const { matrix } = boot();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    await dispatchTerminalMatrixGroupJoin({ id: a.id, group: 'g' });
    await dispatchTerminalMatrixGroupJoin({ id: b.id, group: 'g' });
    const send = await dispatchTerminalBroadcastSend({ group: 'g', text: 'ls\r' });
    expect(send.output).toContain('delivered=2');
    await dispatchTerminalMatrixGroupLeave({ id: b.id, group: 'g' });
    expect([...b.broadcastGroups]).toEqual([]);
  });

  test('ChannelPublish delivers to subscribers', async () => {
    const { matrix } = boot();
    void matrix;
    // No subscribers yet — still returns 0 delivered gracefully.
    const r = await dispatchTerminalChannelPublish({ channel: 'k8s:logs', payload: 'line' });
    expect(r.output).toContain('0 subscribers');
  });

  test('ReadonlySet toggles when on omitted', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    expect(inst.readOnly).toBe(false);
    const r1 = await dispatchTerminalReadonlySet({ id: inst.id });
    expect(r1.output).toContain('readonly=on');
    expect(inst.readOnly).toBe(true);
    const r2 = await dispatchTerminalReadonlySet({ id: inst.id });
    expect(r2.output).toContain('readonly=off');
  });

  test('Recharacter updates character + reexec by default', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const writes = (inst.pty as unknown as { _writes: string[] })._writes;
    const r = await dispatchTerminalRecharacter({ id: inst.id, character: 'claude' });
    expect(r.output).toContain('character=claude-code');
    expect(r.output).toContain('(reexeced)');
    expect(inst.character.kind).toBe('claude-code');
    expect(writes.some(w => w.includes('exec claude-code'))).toBe(true);
  });

  test('Recharacter with reexec:false updates label only', async () => {
    const { matrix } = boot();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const writes = (inst.pty as unknown as { _writes: string[] })._writes;
    writes.length = 0;
    const r = await dispatchTerminalRecharacter({ id: inst.id, character: 'codex', reexec: false });
    expect(r.output).not.toContain('reexeced');
    expect(inst.character.kind).toBe('codex');
    expect(writes).toEqual([]);
  });

  test('unknown id returns friendly message', async () => {
    boot();
    const r = await dispatchTerminalMatrixMove({ id: 'term:999', placement: 'background' });
    expect(r.output).toContain('no terminal matched');
  });

  test('MatrixSpawn accepts character + groups + readonly', async () => {
    boot();
    const r = await dispatchTerminalMatrixSpawn({
      title: 'claude-remote',
      cwd: '/tmp',
      character: 'claude',
      transport: 'tailscale:node-a',
      transport_user: 'admin',
      groups: ['deploy', 'monitor'],
      readonly: false,
    });
    expect(r.output).toContain('character=claude-code transport=tailscale');
  });
});
