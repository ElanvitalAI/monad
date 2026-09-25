import { describe, expect, test } from 'bun:test';
import {
  RESERVED_KEYS,
  RESERVED_ACTION_IDS,
  isReservedKey,
  isReservedActionId,
  validateRebind,
  reservedKeysForContext,
} from '../src/input-core/reserved.js';

describe('input-core reserved — membership', () => {
  test('documented keys are reserved', () => {
    for (const k of ['ctrl+c', 'escape', 'enter', 'ctrl+q', 'ctrl+d']) {
      expect(RESERVED_KEYS.has(k)).toBe(true);
      expect(isReservedKey(k)).toBe(true);
    }
  });

  test('case-insensitive lookup', () => {
    expect(isReservedKey('Ctrl+C')).toBe(true);
    expect(isReservedKey('CTRL+Q')).toBe(true);
    expect(isReservedKey('Escape')).toBe(true);
  });

  test('non-reserved keys pass through', () => {
    expect(isReservedKey('ctrl+b')).toBe(false);
    expect(isReservedKey('s')).toBe(false);
    expect(isReservedKey('tab')).toBe(false);
  });

  test('documented action IDs are reserved', () => {
    for (const id of ['app.interrupt', 'app.quit', 'modal.cancel', 'modal.submit']) {
      expect(RESERVED_ACTION_IDS.has(id)).toBe(true);
      expect(isReservedActionId(id)).toBe(true);
    }
  });
});

describe('input-core reserved — validateRebind', () => {
  test('safe rebind returns null', () => {
    expect(validateRebind('mode.enter.sync', ['ctrl+b+s'])).toBeNull();
    expect(validateRebind('pane.focus.browser', ['click:pane-title.browser'])).toBeNull();
  });

  test('reserved action id → reserved-action violation', () => {
    const v = validateRebind('app.interrupt', ['ctrl+x']);
    expect(v).not.toBeNull();
    expect(v!.kind).toBe('reserved-action');
    expect(v!.value).toBe('app.interrupt');
    expect(v!.message).toContain('app.interrupt');
  });

  test('reserved key → reserved-key violation', () => {
    const v = validateRebind('custom.action', ['ctrl+c']);
    expect(v).not.toBeNull();
    expect(v!.kind).toBe('reserved-key');
    expect(v!.value).toBe('ctrl+c');
  });

  test('reserved action takes precedence over reserved key', () => {
    const v = validateRebind('app.quit', ['ctrl+c']);
    expect(v!.kind).toBe('reserved-action');
  });

  test('mixed keys — first reserved hit wins', () => {
    const v = validateRebind('custom.action', ['ctrl+b+s', 'escape', 'ctrl+c']);
    expect(v!.kind).toBe('reserved-key');
    expect(v!.value).toBe('escape');  // scanning order is left-to-right
  });

  test('empty keys array is allowed (equivalent to unbinding)', () => {
    expect(validateRebind('custom.action', [])).toBeNull();
  });
});

describe('R11 — context-specific reserved', () => {
  test('reservedKeysForContext — input context LETS through Enter + Escape', () => {
    const inputReserved = reservedKeysForContext('input');
    expect(inputReserved.has('enter')).toBe(false);
    expect(inputReserved.has('escape')).toBe(false);
    // Hard interrupts still reserved everywhere.
    expect(inputReserved.has('ctrl+c')).toBe(true);
    expect(inputReserved.has('ctrl+d')).toBe(true);
    expect(inputReserved.has('ctrl+q')).toBe(true);
  });

  test('reservedKeysForContext — modal KEEPS Enter + Escape reserved', () => {
    const modalReserved = reservedKeysForContext('modal');
    expect(modalReserved.has('enter')).toBe(true);
    expect(modalReserved.has('escape')).toBe(true);
  });

  test('reservedKeysForContext — plan-mode reserves Escape only (not Enter)', () => {
    const planReserved = reservedKeysForContext('plan-mode');
    expect(planReserved.has('escape')).toBe(true);
    expect(planReserved.has('enter')).toBe(false);
  });

  test('reservedKeysForContext — unknown context falls back to ALWAYS_RESERVED', () => {
    // 'virtual-window' is a valid ContextTag but not in the per-context
    // override table — should get the base set (hard interrupts only).
    const vwReserved = reservedKeysForContext('virtual-window');
    expect(vwReserved.has('ctrl+c')).toBe(true);
    expect(vwReserved.has('enter')).toBe(false);   // VW pane can rebind Enter freely
  });

  test('reservedKeysForContext — omitted context = global (strictest)', () => {
    const globalReserved = reservedKeysForContext();
    expect(globalReserved.has('enter')).toBe(true);
    expect(globalReserved.has('escape')).toBe(true);
    expect(globalReserved.has('ctrl+c')).toBe(true);
  });

  test('validateRebind — Enter bound in input context is ACCEPTED', () => {
    const v = validateRebind('custom.newline-macro', ['enter'], 'input');
    expect(v).toBeNull();
  });

  test('validateRebind — Enter bound globally is REJECTED (strictest)', () => {
    const v = validateRebind('custom.newline-macro', ['enter']);
    expect(v).not.toBeNull();
    expect(v!.kind).toBe('reserved-key');
    expect(v!.value).toBe('enter');
    expect(v!.context).toBe('global');
  });

  test('validateRebind — Enter bound in modal context is REJECTED', () => {
    const v = validateRebind('custom.override', ['enter'], 'modal');
    expect(v).not.toBeNull();
    expect(v!.context).toBe('modal');
    expect(v!.message).toContain('modal');
  });

  test('ctrl+c is reserved in every declared context', () => {
    const contexts = ['input', 'modal', 'pane-browse', 'plan-mode', 'virtual-window'] as const;
    for (const c of contexts) {
      const v = validateRebind('custom.takeover', ['ctrl+c'], c);
      expect(v).not.toBeNull();
      expect(v!.value).toBe('ctrl+c');
    }
  });
});
