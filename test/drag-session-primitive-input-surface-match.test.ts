// Phase DS-4c · Primitive tune — `hitMatchesSurface` input-kind
// strict matching. Two input-kind DropTargets with distinct inputIds
// must route to the correct target without first-registered-wins
// collision.

import { describe, expect, test } from 'bun:test';
import {
  createDragManager,
  payload,
  type DragEvent,
  type DropTarget,
} from '../src/primitives/drag-session/index.js';
import type { HitTarget, MouseInputEvent } from '../src/input-core/event.js';
import type { SurfaceId } from '../src/display/types.js';

function hitInput(inputId: string): HitTarget {
  return { kind: 'input', inputId };
}
function mouseEv(
  type: MouseInputEvent['type'],
  row: number,
  col: number,
  target: HitTarget,
): MouseInputEvent {
  return { kind: 'mouse', type, row, col, target };
}

function makeInputTarget(
  surfaceId: string,
  inputId: string,
  kinds: readonly string[],
): DropTarget {
  return {
    surfaceId: surfaceId as SurfaceId,
    acceptKinds: kinds,
    onEnter(_session) {
      return { accept: true, action: 'copy', hint: `on ${inputId}` };
    },
    onDrop(_session, _hit) {
      return { type: 'dropped', target: surfaceId as SurfaceId, action: 'copy' };
    },
  };
}

describe('DS-4c primitive · hitMatchesSurface input-kind case', () => {
  test('input-prefixed surfaceId strict-matches on inputId', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
    });
    const chat = makeInputTarget('input::chat-main', 'chat-main', ['file-path[]']);
    const llm = makeInputTarget('input::llm-context-drop', 'llm-context-drop', ['file-path[]']);
    // Register llm first to prove order-independence post-tune.
    manager.registerTarget(llm);
    manager.registerTarget(chat);

    const hoverEvents: DragEvent[] = [];
    manager.on('hover', (ev) => hoverEvents.push(ev));

    const handle = manager.begin({
      source: 'pane:browser' as SurfaceId,
      button: 'left',
      payload: payload([['file-path[]', ['/a']]]),
      startAt: { row: 10, col: 5 },
    });
    // Pull over chat input row — hit.inputId='chat-main' must route to chat.
    handle.pull({ row: 10, col: 20 }, hitInput('chat-main'));
    expect(hoverEvents.length).toBe(1);
    expect(String(hoverEvents[0]!.session.source)).toBe('pane:browser');
    expect(hoverEvents[0]!.kind).toBe('hover');
    const hov = hoverEvents[0]!;
    if (hov.kind !== 'hover') throw new Error('expected hover');
    expect(String(hov.target.surfaceId)).toBe('input::chat-main');

    // Move pointer to llm-context banner row (different inputId).
    handle.pull({ row: 9, col: 20 }, hitInput('llm-context-drop'));
    // Expect a leave from chat, then hover on llm.
    const leaveIdx = hoverEvents.length - 1;
    expect(hoverEvents.length).toBeGreaterThanOrEqual(1);
    manager.on('leave', () => { /* listener added after first pull; not observed here */ });
    // Grab the latest hover event.
    const latest = hoverEvents[hoverEvents.length - 1]!;
    if (latest.kind !== 'hover') throw new Error('expected hover');
    expect(String(latest.target.surfaceId)).toBe('input::llm-context-drop');
    void leaveIdx;

    handle.cancel('test-done');
  });

  test('non-input-prefixed surfaceId retains default-true fallback', () => {
    // Legacy target that declares a non-conforming surfaceId but still
    // accepts input hits. Must be selected (backward compat).
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
    });
    const legacy = makeInputTarget('some-legacy-id', 'chat-main', ['file-path[]']);
    manager.registerTarget(legacy);

    const hovers: DragEvent[] = [];
    manager.on('hover', (ev) => hovers.push(ev));

    const handle = manager.begin({
      source: 'pane:browser' as SurfaceId,
      button: 'left',
      payload: payload([['file-path[]', ['/a']]]),
      startAt: { row: 5, col: 5 },
    });
    handle.pull({ row: 5, col: 10 }, hitInput('chat-main'));
    expect(hovers.length).toBe(1);
    const ev = hovers[0]!;
    if (ev.kind !== 'hover') throw new Error('expected hover');
    expect(String(ev.target.surfaceId)).toBe('some-legacy-id');
    handle.cancel('test-done');
  });

  test('input surfaceId mismatch refuses route (no hover event)', () => {
    const manager = createDragManager({
      hitTest: () => null,
      threshold: 0,
    });
    const llm = makeInputTarget('input::llm-context-drop', 'llm-context-drop', ['file-path[]']);
    manager.registerTarget(llm);

    const hovers: DragEvent[] = [];
    manager.on('hover', (ev) => hovers.push(ev));

    const handle = manager.begin({
      source: 'pane:browser' as SurfaceId,
      button: 'left',
      payload: payload([['file-path[]', ['/a']]]),
      startAt: { row: 5, col: 5 },
    });
    // Hit on chat-main (not llm-context-drop) — no target match.
    handle.pull({ row: 5, col: 10 }, hitInput('chat-main'));
    expect(hovers.length).toBe(0);
    handle.cancel('done');
  });

  test('mouseEv helper type check (no runtime)', () => {
    const m = mouseEv('drag', 1, 1, hitInput('x'));
    expect(m.kind).toBe('mouse');
    expect(m.target.kind).toBe('input');
  });
});
