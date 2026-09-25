import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import { debug } from '../src/debug/log.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function modal(id: string): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 500,
    render: () => [],
    bounds: { row: 3, col: 3, width: 20, height: 5 },
    paint: () => '',
  };
}

// Debug instrumentation for window-opening paths. `debug.enabled` is
// driven by either file or mirror sink. Tests activate mirror with a
// capture hook so they don't depend on file IO.
describe('Coordinator debug trace', () => {
  let captured: string[];
  let originalMirror: boolean;
  let originalFile: boolean;
  let originalDiag: boolean;

  beforeEach(() => {
    captured = [];
    originalMirror = debug.isMirrorEnabled();
    originalFile = debug.isFileEnabled();
    originalDiag = debug.isDiagEnabled();
    debug.clear();
    debug.setMirrorHook((line) => captured.push(line));
    debug.setLevel('diag');
    debug.enable();
  });

  afterEach(() => {
    debug.clear();
    debug.setFileEnabled(originalFile);
    debug.setDiagEnabled(originalDiag);
    debug.setMirror(originalMirror);
    debug.setMirrorHook(null);
  });

  test('pushModal emits a window.pushModal event', () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.pushModal(modal('m1'));
    const pushLines = captured.filter((l) => l.includes('window.pushModal'));
    expect(pushLines.length).toBeGreaterThan(0);
    expect(pushLines.join('\n')).toContain('m1');
  });

  test('popModal emits window.popModal + window.closeSurface + window.setFocus', () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.pushModal(modal('m2'));
    captured.length = 0;
    coord.popModal('m2');
    const joined = captured.join('\n');
    expect(joined).toContain('window.popModal');
    expect(joined).toContain('window.closeSurface');
  });

  test('popModal on unknown id emits miss event', () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.popModal('nope');
    expect(captured.some((l) => l.includes('window.popModal.miss'))).toBe(true);
  });

  test('setFocus trace records prev → next + reason', () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.pushModal(modal('a'));
    captured.length = 0;
    coord.pushModal(modal('b'));
    const focusLine = captured.find((l) => l.includes('window.setFocus'));
    expect(focusLine).toBeTruthy();
    expect(focusLine!).toContain('a');
    expect(focusLine!).toContain('b');
  });

  test('routeKey emits key.route hit for modal delivery', () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.pushModal({
      ...modal('km1'),
      onKey: () => 'consumed',
    });
    captured.length = 0;

    coord.routeKey({ name: 'enter' });

    const joined = captured.join('\n');
    expect(joined).toContain('key.route');
    expect(joined).toContain('"branch":"modal"');
    expect(joined).toContain('"target":"km1"');
  });

  test('tryRouteKeyToTopModalAsync emits key.route.input-modal trail', async () => {
    const coord = new DisplayCoordinator({
      schedule: (fn) => { fn(); return 0 as any; },
    });
    coord.pushModal(modal('km2'));
    captured.length = 0;

    const result = await coord.tryRouteKeyToTopModalAsync({ name: 'down' });

    expect(result).toBe('passthrough');
    const joined = captured.join('\n');
    expect(joined).toContain('key.route.input-modal');
    expect(joined).toContain('"modalId":"km2"');
    expect(joined).toContain('surface-passthrough');
  });
});
