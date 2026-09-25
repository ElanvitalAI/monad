// H5 Phase 2 · TTY snapshot LLM tool tests.

import { afterEach, describe, test, expect } from 'bun:test';
import {
  buildSnapshotPtyStateTool,
  buildListPtySnapshotsTool,
  buildComparePtySnapshotsTool,
  dispatchSnapshotPtyState,
  dispatchListPtySnapshots,
  dispatchComparePtySnapshots,
  initTtySnapshotTools,
  _resetTtySnapshotToolsForTesting,
} from '../src/skills/tools/tty-snapshot.js';

function makeLookup(sessions: Record<string, string>, panes: Record<string, string> = {}) {
  return {
    findSession(id: string) {
      const screen = sessions[id];
      if (!screen) return undefined;
      return { id, snapshot: async () => screen };
    },
    findSessionByPaneId(paneId: string) {
      const sessionId = panes[paneId];
      if (!sessionId) return undefined;
      const screen = sessions[sessionId];
      if (!screen) return undefined;
      return { id: sessionId, snapshot: async () => screen };
    },
  };
}

afterEach(() => {
  _resetTtySnapshotToolsForTesting();
});

describe('TTY snapshot tool specs', () => {
  test('SnapshotPtyState spec shape', () => {
    const s = buildSnapshotPtyStateTool();
    expect(s.name).toBe('SnapshotPtyState');
    const props = (s.parameters as { properties: Record<string, unknown> }).properties;
    expect(props.session_id).toBeDefined();
    expect(props.pane_id).toBeDefined();
    expect(props.label).toBeDefined();
  });

  test('ListPtySnapshots spec requires session_id', () => {
    const s = buildListPtySnapshotsTool();
    const params = s.parameters as { required?: string[] };
    expect(params.required).toEqual(['session_id']);
  });

  test('ComparePtySnapshots spec requires a + b', () => {
    const s = buildComparePtySnapshotsTool();
    const params = s.parameters as { required?: string[] };
    expect(params.required).toEqual(['a', 'b']);
  });
});

describe('dispatchSnapshotPtyState', () => {
  test('captures from session_id · returns snapshot metadata', async () => {
    initTtySnapshotTools(makeLookup({ 'sess-a': 'hello' }));
    const r = await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'before' });
    expect(r.snapshot.id).toMatch(/^snap-/);
    expect(r.snapshot.bytes).toBe(5);
    expect(r.snapshot.label).toBe('before');
    expect(r.output).toContain('before');
  });

  test('captures from pane_id via lookup bridge', async () => {
    initTtySnapshotTools(makeLookup({ 'sess-x': 'from-pane' }, { 'pane-1': 'sess-x' }));
    const r = await dispatchSnapshotPtyState({ pane_id: 'pane-1' });
    expect(r.snapshot.bytes).toBe(9);
  });

  test('missing both session_id and pane_id rejects', async () => {
    initTtySnapshotTools(makeLookup({}));
    let err: unknown;
    try {
      await dispatchSnapshotPtyState({});
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/session_id \/ pane_id/);
  });

  test('unknown session surfaces clear error', async () => {
    initTtySnapshotTools(makeLookup({}));
    let err: unknown;
    try {
      await dispatchSnapshotPtyState({ session_id: 'nope' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/not found/);
  });

  test('not wired rejects with actionable message', async () => {
    let err: unknown;
    try {
      await dispatchSnapshotPtyState({ session_id: 'x' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/not wired/);
  });
});

describe('dispatchListPtySnapshots', () => {
  test('lists newest first · honors limit', async () => {
    initTtySnapshotTools(makeLookup({ 'sess-a': 'abcdef' }));
    await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'one' });
    await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'two' });
    await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'three' });
    const out = await dispatchListPtySnapshots({ session_id: 'sess-a', limit: 2 });
    expect(out.snapshots.length).toBe(2);
    expect(out.snapshots[0]!.label).toBe('three');
  });

  test('empty session returns empty list', async () => {
    initTtySnapshotTools(makeLookup({}));
    const out = await dispatchListPtySnapshots({ session_id: 'missing' });
    expect(out.snapshots).toEqual([]);
  });
});

describe('dispatchComparePtySnapshots', () => {
  test('line-diff two captures', async () => {
    initTtySnapshotTools(makeLookup({ 'sess-a': 'one\ntwo\nthree' }));
    const r1 = await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'a' });
    // Change the session screen between captures
    initTtySnapshotTools(makeLookup({ 'sess-a': 'one\ntwo\nfour' }));
    const r2 = await dispatchSnapshotPtyState({ session_id: 'sess-a', label: 'b' });
    const d = await dispatchComparePtySnapshots({ a: r1.snapshot.id, b: r2.snapshot.id });
    expect(d.added).toEqual(['four']);
    expect(d.removed).toEqual(['three']);
    expect(d.sameLines).toBe(2);
  });

  test('missing snapshot id rejects', async () => {
    initTtySnapshotTools(makeLookup({}));
    let err: unknown;
    try {
      await dispatchComparePtySnapshots({ a: 'nope-1', b: 'nope-2' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/not found/);
  });
});
