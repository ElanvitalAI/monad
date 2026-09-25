// ── VW-term-infra Phase 0 — Invariant Lattice ──
//
// Property test that TerminalInstance.pty REFERENCE is preserved
// across every legal placement transition (background <-> preview
// <-> modal <-> vw). Plus: cursor coordinates · cols/rows dims ·
// visibility · transport · character identity all survive a
// placement move.
//
// These invariants are the foundation Phase 1's Pane contract leans
// on — the refactor must NOT break them. If any test here regresses,
// the refactor has violated "Identity Preservation" (원칙 ②).
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p0-p2` §2
//      내부 문서 `ROADMAP-vw-term-infra` §7 "아름다움 원칙 ②"
//      내부 문서 `CAPABILITIES-terminal` §3.1.1 Invariant Lattice

import { describe, expect, test } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import { TerminalRegistry } from '../../src/terminal-matrix/registry.js';
import type { TerminalPlacement } from '../../src/terminal-matrix/types.js';

function fakePreviewFactory(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  let cols = opts.cols;
  let rows = opts.rows;
  return {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: () => {},
    resize: (c: number, r: number) => { cols = c; rows = r; },
    render: () => 'row0\nrow1',
    cursorPosition: () => alive ? ({ row: 0, col: 0 }) : null,
    get isAlive(): boolean { return alive; },
    get cols(): number { return cols; },
    get rows(): number { return rows; },
    get pid(): number { return 42; },
    get isScrolledBack(): boolean { return false; },
    get scrollbackOffset(): number { return 0; },
    get wantsMouse(): boolean { return false; },
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
  } as unknown as PreviewTerminal;
}

function makeMatrix() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: fakePreviewFactory,
  });
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 100, rows: 30 }),
  });
  return { matrix };
}

// Scope note: preview / vw placements land via PlacementTransitionAdapter
// plugins (registered in T2b / T3). With only the native session
// registry wired (what the fake factory exposes), the legal
// transitions are modal ↔ background. We lock those invariants here;
// adapter-based transitions (preview / vw) are covered by their
// dedicated adapter tests (preview-slot-adapter.test.ts · vw-placement-adapter.test.ts).

describe('Phase 0 invariant — pty reference preserved across native placement moves', () => {
  test('pty reference equality survives modal -> background', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    expect(inst.placement.kind).toBe('modal');
    const ptyBefore = inst.pty;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.pty).toBe(ptyBefore);
    expect(inst.pty.isAlive).toBe(true);
  });

  test('pty reference equality survives background -> modal', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const ptyBefore = inst.pty;
    matrix.move(inst.id, { kind: 'background' });
    matrix.move(inst.id, { kind: 'modal', modalId: 'after-bg' });
    expect(inst.pty).toBe(ptyBefore);
  });

  test('pty reference equality survives round-trip modal -> bg -> modal', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const ptyBefore = inst.pty;
    matrix.move(inst.id, { kind: 'background' });
    matrix.move(inst.id, { kind: 'modal', modalId: 'returned' });
    expect(inst.pty).toBe(ptyBefore);
  });
});

describe('Phase 0 invariant — pid / dims / cursor preserved across native moves', () => {
  test('pty.pid is preserved across modal <-> background round trip', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const pidBefore = inst.pty.pid;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.pty.pid).toBe(pidBefore);
    matrix.move(inst.id, { kind: 'modal', modalId: 'refocus' });
    expect(inst.pty.pid).toBe(pidBefore);
  });

  test('cols × rows dims preserved across native placement move', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const colsBefore = inst.pty.cols;
    const rowsBefore = inst.pty.rows;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.pty.cols).toBe(colsBefore);
    expect(inst.pty.rows).toBe(rowsBefore);
  });

  test('cursor position preserved across native placement move', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const curBefore = inst.pty.cursorPosition();
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.pty.cursorPosition()).toEqual(curBefore);
  });
});

describe('Phase 0 invariant — meta (transport / visibility / character / id) unchanged by placement move', () => {
  test('transport.kind is frozen across native placement moves', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const transportBefore = inst.transport;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.transport).toBe(transportBefore);
    expect(inst.transport.kind).toBe('local');
  });

  test('visibility is not mutated by a native placement move', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp', visibility: 'both' });
    expect(inst.visibility).toBe('both');
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.visibility).toBe('both');
    matrix.move(inst.id, { kind: 'modal', modalId: 'refocus' });
    expect(inst.visibility).toBe('both');
  });

  test('character.kind is unchanged by a placement move (mutation path is separate)', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const characterBefore = inst.character;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.character).toBe(characterBefore);
    expect(inst.character.kind).toBe('shell');
  });

  test('id remains stable across placement moves (term:<N> format)', () => {
    const { matrix } = makeMatrix();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const idBefore = inst.id;
    matrix.move(inst.id, { kind: 'background' });
    expect(inst.id).toBe(idBefore);
    expect(inst.id).toMatch(/^term:\d+$/);
  });
});
