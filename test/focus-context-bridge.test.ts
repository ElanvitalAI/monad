// IDX-2c Phase 2 — focus ContextKeys bridge tests.
//
// Covers deriveFocusContextKeys + publishFocusContextKeys +
// publishFocusContextKeysFromService. Each test builds a fresh
// ContextKeyService so assertions don't collide with the dashboard
// singleton.

import { describe, expect, test } from 'bun:test';
import {
  createContextKeyService,
  INITIAL_CONTEXT_KEYS,
} from '../src/input-core/context-keys.js';
import {
  deriveFocusContextKeys,
  publishFocusContextKeys,
  publishFocusContextKeysFromService,
} from '../src/dashboard/context/focus-bridge.js';

describe('deriveFocusContextKeys (pure mapping)', () => {
  test('terminal modal wins over every other flag', () => {
    expect(
      deriveFocusContextKeys({
        focus: 'browser',
        terminalModalActive: true,
        anyModalOpen: true,
      }),
    ).toEqual({ focusMode: 'terminal', activePaneId: null });
  });

  test('any other modal → focusMode=modal, activePaneId=null', () => {
    expect(
      deriveFocusContextKeys({
        focus: 'obsidian',
        terminalModalActive: false,
        anyModalOpen: true,
      }),
    ).toEqual({ focusMode: 'modal', activePaneId: null });
  });

  test('focus=input without modals → focusMode=input, activePaneId=null', () => {
    expect(
      deriveFocusContextKeys({
        focus: 'input',
        terminalModalActive: false,
        anyModalOpen: false,
      }),
    ).toEqual({ focusMode: 'input', activePaneId: null });
  });

  test('arbitrary pane focus without modals → focusMode=pane + id', () => {
    expect(
      deriveFocusContextKeys({
        focus: 'browser',
        terminalModalActive: false,
        anyModalOpen: false,
      }),
    ).toEqual({ focusMode: 'pane', activePaneId: 'browser' });
  });

  test('plugin-namespaced pane focus preserved as-is', () => {
    expect(
      deriveFocusContextKeys({
        focus: 'plugin:sync',
        terminalModalActive: false,
        anyModalOpen: false,
      }),
    ).toEqual({ focusMode: 'pane', activePaneId: 'plugin:sync' });
  });
});

describe('publishFocusContextKeys (direct args)', () => {
  test('initial publish seeds the service with derived state', () => {
    const svc = createContextKeyService();
    publishFocusContextKeys({
      focus: 'browser',
      terminalModalActive: false,
      anyModalOpen: false,
      service: svc,
    });
    expect(svc.keys.focusMode).toBe('pane');
    expect(svc.keys.activePaneId).toBe('browser');
  });

  test('repeat call with unchanged state is a no-op (equality-gated)', () => {
    const svc = createContextKeyService();
    let fires = 0;
    svc.subscribe(() => { fires++; });
    // prime fire = 1
    expect(fires).toBe(1);

    publishFocusContextKeys({
      focus: 'browser',
      terminalModalActive: false,
      anyModalOpen: false,
      service: svc,
    });
    expect(fires).toBe(2);

    publishFocusContextKeys({
      focus: 'browser',
      terminalModalActive: false,
      anyModalOpen: false,
      service: svc,
    });
    // No change → no additional fire
    expect(fires).toBe(2);
  });

  test('transitioning from pane → modal clears activePaneId', () => {
    const svc = createContextKeyService();
    publishFocusContextKeys({
      focus: 'browser',
      terminalModalActive: false,
      anyModalOpen: false,
      service: svc,
    });
    expect(svc.keys.activePaneId).toBe('browser');

    publishFocusContextKeys({
      focus: 'browser',
      terminalModalActive: false,
      anyModalOpen: true,        // modal opened
      service: svc,
    });
    expect(svc.keys.focusMode).toBe('modal');
    expect(svc.keys.activePaneId).toBeNull();
  });
});

describe('publishFocusContextKeysFromService (reads flags from service)', () => {
  test('seeds derived state from the service snapshot', () => {
    const svc = createContextKeyService();
    // Simulate an open picker
    svc.update({ pickerOpen: true });

    publishFocusContextKeysFromService('browser', svc);

    expect(svc.keys.focusMode).toBe('modal');
    expect(svc.keys.activePaneId).toBeNull();
    // pickerOpen is unchanged (we only updated focus keys)
    expect(svc.keys.pickerOpen).toBe(true);
  });

  test('terminalModalActive overrides popup-tier flags', () => {
    const svc = createContextKeyService();
    svc.update({ terminalModalActive: true, popupOpen: true });

    publishFocusContextKeysFromService('browser', svc);

    expect(svc.keys.focusMode).toBe('terminal');
    expect(svc.keys.activePaneId).toBeNull();
  });

  test('no modals + input focus → focusMode=input', () => {
    const svc = createContextKeyService();
    publishFocusContextKeysFromService('input', svc);
    expect(svc.keys.focusMode).toBe('input');
    expect(svc.keys.activePaneId).toBeNull();
  });

  test('INITIAL_CONTEXT_KEYS has focusMode="pane" and null pane — sanity default', () => {
    expect(INITIAL_CONTEXT_KEYS.focusMode).toBe('pane');
    expect(INITIAL_CONTEXT_KEYS.activePaneId).toBeNull();
  });
});
