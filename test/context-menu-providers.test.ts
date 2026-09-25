// CMX-1 · MenuProviderRegistry tests.

import { describe, expect, test } from 'bun:test';
import {
  createMenuProviderRegistry,
  hitKey,
  wildcardKey,
  type MenuProvider,
} from '../src/ui/context-menu-providers.js';
import type { Menu } from '../src/ui/context-menu-registry.js';
import type { HitTarget } from '../src/display/types.js';

const pill = (name: string): HitTarget =>
  ({ kind: 'pill', name: name as never });
const paneBody = (paneId: string): HitTarget => ({ kind: 'pane-body', paneId });
const paneTitle = (paneId: string): HitTarget => ({ kind: 'pane-title', paneId });
const input = (inputId: string): HitTarget => ({ kind: 'input', inputId });
// Display HitTarget uses windowId: string (not number).
const vwPaneBody = (paneId: string, windowId = '1'): HitTarget =>
  ({ kind: 'vw-pane-body', windowId, paneId });
const statusBar = (): HitTarget => ({ kind: 'status-bar' });
const modalBody = (modalId = 'm1'): HitTarget =>
  ({ kind: 'modal-body', modalId: modalId as never });

const menu = (label: string): Menu => ({
  items: [{ kind: 'command', id: 'x', label }],
});

describe('CMX-1 · hitKey helper', () => {
  test('pill → pill:<name>', () => {
    expect(hitKey(pill('model'))).toBe('pill:model');
  });
  test('pane-body → pane-body:<paneId>', () => {
    expect(hitKey(paneBody('browser'))).toBe('pane-body:browser');
  });
  test('pane-title → pane-title:<paneId>', () => {
    expect(hitKey(paneTitle('chat'))).toBe('pane-title:chat');
  });
  test('pane-nav-tab → pane-nav-tab:<paneId>', () => {
    expect(hitKey({ kind: 'pane-nav-tab', paneId: 'settings' })).toBe('pane-nav-tab:settings');
  });
  test('input → input:<inputId>', () => {
    expect(hitKey(input('chat-main'))).toBe('input:chat-main');
  });
  test('vw-pane-body → vw-pane-body:<windowId>:<paneId>', () => {
    expect(hitKey(vwPaneBody('term-1', '2'))).toBe('vw-pane-body:2:term-1');
  });
  test('status-bar → bare key', () => {
    expect(hitKey(statusBar())).toBe('status-bar');
  });
  test('modal-body → modal-body:<modalId>', () => {
    expect(hitKey(modalBody('approval-1'))).toBe('modal-body:approval-1');
  });
  test('modal-button → modal-button:<buttonId>', () => {
    expect(hitKey({ kind: 'modal-button', modalId: 'm' as never, buttonId: 'ok' })).toBe('modal-button:ok');
  });
});

describe('CMX-1 · wildcardKey helper', () => {
  test('pill → pill:*', () => expect(wildcardKey(pill('model'))).toBe('pill:*'));
  test('pane-body → pane-body:*', () => expect(wildcardKey(paneBody('x'))).toBe('pane-body:*'));
  test('pane-title → pane-title:*', () => expect(wildcardKey(paneTitle('x'))).toBe('pane-title:*'));
  test('input → input:*', () => expect(wildcardKey(input('x'))).toBe('input:*'));
  test('status-bar → null (no specifier to wildcard)', () => {
    expect(wildcardKey(statusBar())).toBeNull();
  });
  test('modal-body → modal-body:*', () => expect(wildcardKey(modalBody())).toBe('modal-body:*'));
});

describe('CMX-1 · createMenuProviderRegistry · register + resolve', () => {
  test('specific key registration → resolve matches only that hit', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pane-body:browser', () => menu('browser-only'));

    const matched = reg.resolve(paneBody('browser'));
    expect(matched?.items[0]!.kind).toBe('command');
    if (matched?.items[0]!.kind === 'command') {
      expect(matched.items[0].label).toBe('browser-only');
    }

    expect(reg.resolve(paneBody('scratch'))).toBeNull();
    expect(reg.resolve(paneTitle('browser'))).toBeNull();
  });

  test('wildcard key registration → matches any hit of that kind', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pane-body:*', (hit) => menu(`hit-${hit.kind === 'pane-body' ? hit.paneId : '?'}`));

    const a = reg.resolve(paneBody('browser'));
    const b = reg.resolve(paneBody('scratch'));
    expect(a?.items[0]!.kind === 'command' && a.items[0].label).toBe('hit-browser');
    expect(b?.items[0]!.kind === 'command' && b.items[0].label).toBe('hit-scratch');
  });

  test('specific match wins over wildcard', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pane-body:*',       () => menu('wildcard'));
    reg.register('pane-body:browser', () => menu('specific'));

    const got = reg.resolve(paneBody('browser'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('specific');

    const other = reg.resolve(paneBody('scratch'));
    expect(other?.items[0]!.kind === 'command' && other.items[0].label).toBe('wildcard');
  });

  test('specific provider returning null falls through to wildcard', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pane-body:browser', () => null);
    reg.register('pane-body:*',       () => menu('wildcard-fallback'));

    const got = reg.resolve(paneBody('browser'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('wildcard-fallback');
  });

  test('wildcard returning null → overall null', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pane-body:*', () => null);
    expect(reg.resolve(paneBody('x'))).toBeNull();
  });

  test('no registration → null', () => {
    const reg = createMenuProviderRegistry();
    expect(reg.resolve(paneBody('x'))).toBeNull();
  });

  test('ctx is passed through to provider', () => {
    const reg = createMenuProviderRegistry();
    let capturedCtx: unknown = null;
    reg.register('pill:model', (_hit, ctx) => {
      capturedCtx = ctx;
      return menu('x');
    });
    reg.resolve(pill('model'), { selection: 'abc', readonly: true });
    expect(capturedCtx).toEqual({ selection: 'abc', readonly: true });
  });

  test('ctx defaults to empty record when omitted', () => {
    const reg = createMenuProviderRegistry();
    let capturedCtx: unknown = null;
    reg.register('pill:model', (_hit, ctx) => { capturedCtx = ctx; return menu('x'); });
    reg.resolve(pill('model'));
    expect(capturedCtx).toEqual({});
  });
});

describe('CMX-1 · register lifecycle', () => {
  test('dispose removes the registration', () => {
    const reg = createMenuProviderRegistry();
    const dispose = reg.register('pane-body:browser', () => menu('a'));
    expect(reg.resolve(paneBody('browser'))).not.toBeNull();
    dispose();
    expect(reg.resolve(paneBody('browser'))).toBeNull();
  });

  test('dispose is idempotent', () => {
    const reg = createMenuProviderRegistry();
    const dispose = reg.register('pane-body:browser', () => menu('a'));
    dispose();
    dispose();  // no-op
    expect(reg.resolve(paneBody('browser'))).toBeNull();
  });

  test('latest registration wins on same key', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pill:model', () => menu('first'));
    reg.register('pill:model', () => menu('second'));
    const got = reg.resolve(pill('model'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('second');
  });

  test('disposing earlier registration when later one exists still leaves the later live', () => {
    const reg = createMenuProviderRegistry();
    const dispose1 = reg.register('pill:model', () => menu('first'));
    reg.register('pill:model', () => menu('second'));
    dispose1();
    const got = reg.resolve(pill('model'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('second');
  });

  test('disposing latest → earlier becomes active again', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pill:model', () => menu('first'));
    const dispose2 = reg.register('pill:model', () => menu('second'));
    dispose2();
    const got = reg.resolve(pill('model'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('first');
  });

  test('size counts multi-registrations correctly', () => {
    const reg = createMenuProviderRegistry();
    expect(reg.size()).toBe(0);
    const d1 = reg.register('pill:model', () => menu('a'));
    reg.register('pill:model', () => menu('b'));
    reg.register('pane-body:browser', () => menu('c'));
    expect(reg.size()).toBe(3);
    d1();
    expect(reg.size()).toBe(2);
  });

  test('clear() removes all', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pill:model', () => menu('a'));
    reg.register('pane-body:*', () => menu('b'));
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.resolve(paneBody('x'))).toBeNull();
  });
});

describe('CMX-1 · kind-specific resolve paths', () => {
  test('input-kind hits resolve via input: prefix', () => {
    const reg = createMenuProviderRegistry();
    reg.register('input:chat-main', () => menu('chat-ctx'));
    const got = reg.resolve(input('chat-main'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('chat-ctx');
  });

  test('pill-kind hits resolve via pill: prefix', () => {
    const reg = createMenuProviderRegistry();
    reg.register('pill:wd', () => menu('wd-ctx'));
    const got = reg.resolve(pill('wd'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('wd-ctx');
  });

  test('vw-pane-body kind → canonical key resolves', () => {
    const reg = createMenuProviderRegistry();
    reg.register('vw-pane-body:3:term-1', () => menu('vw-term'));
    const got = reg.resolve(vwPaneBody('term-1', '3'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('vw-term');
  });

  test('vw-pane-body legacy paneId-only key still resolves during migration', () => {
    const reg = createMenuProviderRegistry();
    reg.register('vw-pane-body:term-1', () => menu('vw-term-legacy'));
    const got = reg.resolve(vwPaneBody('term-1', '3'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('vw-term-legacy');
  });

  test('status-bar has no wildcard · only bare key match', () => {
    const reg = createMenuProviderRegistry();
    reg.register('status-bar', () => menu('sb'));
    const got = reg.resolve(statusBar());
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('sb');
  });

  test('modal-body hit → specific modalId match', () => {
    const reg = createMenuProviderRegistry();
    reg.register('modal-body:approval-1', () => menu('approval-ctx'));
    const got = reg.resolve(modalBody('approval-1'));
    expect(got?.items[0]!.kind === 'command' && got.items[0].label).toBe('approval-ctx');
  });
});
