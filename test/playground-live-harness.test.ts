// F-B2 — LivePlaygroundHarness unit tests.
//
// Uses a fake DisplayCoordinator + ContextKeyService so the
// harness can be exercised without a real TUI. Proves mount /
// dismiss / click / key / theme / context-key wiring against the
// coordinator interface the LiveHarness depends on.

import { describe, expect, test } from 'bun:test';

import { createContextKeyService } from '../src/input-core/context-keys.js';
import {
  createLivePlaygroundHarness,
  DIALOG_CONFIRM_FLOW,
  PICKER_ROW_CLICK_FLOW,
  runScenario,
} from '../src/playground-scenario/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

// ── Fake DisplayCoordinator ──────────────────────────────────────

function createFakeCoordinator() {
  const stack: string[] = [];
  const surfaces = new Map<string, ModalSurface>();
  const coordinator = {
    pushModal(surface: ModalSurface) {
      stack.push(surface.id);
      surfaces.set(surface.id, surface);
      return {
        id: surface.id,
        dispose: () => {
          const i = stack.lastIndexOf(surface.id);
          if (i >= 0) stack.splice(i, 1);
          surfaces.delete(surface.id);
        },
      };
    },
    modalStack(): string[] {
      return [...stack];
    },
    _surface(id: string): ModalSurface | undefined {
      return surfaces.get(id);
    },
  };
  return coordinator;
}

function makeHarness(opts: { term?: { rows: number; cols: number }; theme?: (name: string) => void } = {}) {
  const coordinator = createFakeCoordinator();
  const contextKeys = createContextKeyService();
  const themeLog: string[] = [];
  const harness = createLivePlaygroundHarness({
    coordinator: coordinator as never,
    contextKeys,
    termSize: () => opts.term ?? { rows: 24, cols: 80 },
    setTheme: opts.theme ?? ((name: string) => { themeLog.push(name); }),
  });
  return { harness, coordinator, contextKeys, themeLog };
}

describe('LivePlaygroundHarness · mount / dismiss', () => {
  test('mount dialog pushes onto coordinator stack', () => {
    const { harness, coordinator } = makeHarness();
    harness.mount({
      id: 'd1', kind: 'dialog',
      props: { title: 'T', buttons: [{ value: 'ok', label: 'OK', buttonId: 'ok' }] },
    });
    expect(coordinator.modalStack()).toEqual(['d1']);
  });

  test('dismiss by id pops the matching modal', () => {
    const { harness, coordinator } = makeHarness();
    harness.mount({ id: 'a', kind: 'button', props: { label: 'A' } });
    harness.mount({ id: 'b', kind: 'button', props: { label: 'B' } });
    harness.dismiss('a');
    expect(coordinator.modalStack()).toEqual(['b']);
  });

  test('dismiss without id pops topmost OWNED modal', () => {
    const { harness, coordinator } = makeHarness();
    harness.mount({ id: 'a', kind: 'button', props: { label: 'A' } });
    harness.mount({ id: 'b', kind: 'button', props: { label: 'B' } });
    harness.dismiss();
    expect(coordinator.modalStack()).toEqual(['a']);
    harness.dismiss();
    expect(coordinator.modalStack()).toEqual([]);
  });

  test('disposeAll clears every harness-owned modal', () => {
    const { harness, coordinator } = makeHarness();
    harness.mount({ id: 'a', kind: 'button', props: { label: 'A' } });
    harness.mount({ id: 'b', kind: 'button', props: { label: 'B' } });
    harness.disposeAll();
    expect(coordinator.modalStack()).toEqual([]);
  });
});

describe('LivePlaygroundHarness · click / key', () => {
  test('click by component-id updates lastClickedComponentId', () => {
    const { harness } = makeHarness();
    harness.mount({ id: 'btn', kind: 'button', props: { label: 'Go' } });
    harness.click({ kind: 'component', componentId: 'btn' }, 'left');
    expect(harness.getLastClickedComponentId()).toBe('btn');
  });

  test('click by hit-target fires mounted surface onMouse', () => {
    const { harness } = makeHarness();
    harness.mount({
      id: 'select',
      kind: 'select',
      props: {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ],
      },
    });
    harness.click(
      { kind: 'hit', hitTarget: { kind: 'modal-body', modalId: 'select', itemIndex: 1 } },
      'left',
    );
    expect(harness.getLastClickedComponentId()).toBe('select:b');
  });

  test('key event forwarded to topmost owned surface', () => {
    const { harness } = makeHarness();
    harness.mount({
      id: 'select',
      kind: 'select',
      props: {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        initialCursor: 0,
      },
    });
    // Down + Enter should pick 'b'.
    harness.key({ name: 'down' } as never);
    harness.key({ name: 'enter' } as never);
    expect(harness.getLastClickedComponentId()).toBe('select:b');
  });
});

describe('LivePlaygroundHarness · theme / context-keys', () => {
  test('setTheme delegates to deps.setTheme', () => {
    const log: string[] = [];
    const { harness } = makeHarness({ theme: (n) => log.push(n) });
    harness.setTheme('nord-light');
    expect(log).toEqual(['nord-light']);
  });

  test('setContextKey / getContextKey round-trips via service', () => {
    const { harness, contextKeys } = makeHarness();
    harness.setContextKey('themeName' as never, 'monad-pastel-default' as never);
    expect(harness.getContextKey('themeName' as never)).toBe('monad-pastel-default');
    expect(contextKeys.keys.themeName).toBe('monad-pastel-default');
  });
});

describe('LivePlaygroundHarness · DEFAULT_SCENARIOS integration', () => {
  test('DIALOG_CONFIRM_FLOW passes end-to-end', async () => {
    const { harness } = makeHarness();
    const r = await runScenario(DIALOG_CONFIRM_FLOW, harness);
    expect(r.status).toBe('pass');
  });

  test('PICKER_ROW_CLICK_FLOW passes against LiveHarness (regression guard)', async () => {
    const { harness } = makeHarness();
    const r = await runScenario(PICKER_ROW_CLICK_FLOW, harness);
    // Key difference vs FakeHarness: the live harness's select
    // builder routes the hit-target click through the mounted
    // surface's onMouse → updates lastClickedComponentId. A
    // regression in that dispatch (like the F-E bug) would FAIL
    // this scenario, surfacing it in the next `/playground run`.
    expect(r.status).toBe('pass');
  });
});
